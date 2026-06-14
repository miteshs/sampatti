#!/usr/bin/env bash
# Wrap the already-built, signed Sampatti.app in a signed .pkg installer so a friend can
# double-click → Continue → Install (app lands in /Applications, no drag-to-Applications step).
#
#   scripts/build-pkg.sh            # build + sign the pkg
#   scripts/build-pkg.sh --notarize # also submit to Apple notary (--wait) + staple
#
# Prereqs:
#   • Sampatti.app must already exist & be signed (run the normal `npm run tauri build`
#     with APPLE_SIGNING_IDENTITY exported first — this script does NOT rebuild the app).
#   • .env.signing must define APPLE_INSTALLER_IDENTITY (Developer ID Installer cert) — a
#     DIFFERENT cert from the Developer ID Application one that signs the app itself.
#
# A notarized pkg is its own submission (separate from the dmg). Until it staples, the
# friend sees one "Open Anyway" on first launch — same as the dmg.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

[ -f .env.signing ] || { echo "✗ .env.signing missing — need APPLE_INSTALLER_IDENTITY."; exit 1; }
set -a; . ./.env.signing; set +a
: "${APPLE_INSTALLER_IDENTITY:?set APPLE_INSTALLER_IDENTITY in .env.signing}"

VERSION=$(node -e "console.log(require('./src-tauri/tauri.conf.json').version)")
APP="src-tauri/target/release/bundle/macos/Sampatti.app"
OUT="src-tauri/target/release/bundle/Sampatti_${VERSION}_aarch64.pkg"

[ -d "$APP" ] || { echo "✗ $APP not found — build the app first (npm run tauri build)."; exit 1; }

# The app must already carry a valid Developer ID signature + hardened runtime, or the pkg
# is pointless (notarization would reject the app inside it).
codesign --verify --strict "$APP" 2>/dev/null || { echo "✗ $APP is not validly signed."; exit 1; }
# (capture, don't pipe to grep -q: grep exits on first match → SIGPIPE → pipefail false-fail)
case "$(codesign -dvv "$APP" 2>&1)" in
  *"flags=0x10000(runtime)"*) ;;
  *) echo "✗ $APP lacks hardened runtime."; exit 1 ;;
esac

# Stage only the app (payload root must contain ONLY Sampatti.app); keep scratch files in a
# SEPARATE work dir so they never land in the pkg payload.
STAGE="$(mktemp -d)"; WORK="$(mktemp -d)"; trap 'rm -rf "$STAGE" "$WORK"' EXIT
cp -R "$APP" "$STAGE/"

echo "▶ Building signed pkg for Sampatti ${VERSION}…"
# CRITICAL: disable bundle relocation. By default pkgbuild marks app bundles relocatable, so
# the Installer chases a LaunchServices record for an existing app.sampatti.desktop and installs
# *there* instead of /Applications — even if that copy is in the Trash. (v0.8.1's first pkg did
# exactly this: receipt written for /Applications, payload relocated onto a stale path → nothing
# installed.) An explicit component plist with BundleIsRelocatable=false pins it to /Applications.
COMP="$WORK/component.plist"
pkgbuild --analyze --root "$STAGE" "$COMP" >/dev/null
/usr/libexec/PlistBuddy -c "Set :0:BundleIsRelocatable false" "$COMP"

pkgbuild \
  --root "$STAGE" \
  --component-plist "$COMP" \
  --install-location /Applications \
  --identifier app.sampatti.desktop \
  --version "$VERSION" \
  --sign "$APPLE_INSTALLER_IDENTITY" \
  "$OUT"

# Prove the installer signature before handing it over.
case "$(pkgutil --check-signature "$OUT" 2>&1)" in
  *"signed by a developer certificate issued by Apple"*) ;;
  *) echo "✗ pkg signature check failed."; exit 1 ;;
esac

# Gate: the built pkg must NOT relocate (no bundle listed inside <relocate>), or it can install
# into a stale/registered/trashed copy again instead of /Applications.
CHECK="$WORK/expand"; pkgutil --expand "$OUT" "$CHECK" >/dev/null 2>&1
if grep -A1 "<relocate>" "$CHECK/PackageInfo" | grep -q "<bundle "; then
  echo "✗ pkg still marks the app relocatable — it may not install to /Applications. Aborting."
  exit 1
fi
echo "✓ relocation disabled (installs to /Applications)"

echo "✓ Built $OUT"
echo "  sha256: $(shasum -a 256 "$OUT" | awk '{print $1}')"

if [ "${1:-}" = "--notarize" ]; then
  : "${APPLE_API_KEY_PATH:?}" "${APPLE_API_KEY:?}" "${APPLE_API_ISSUER:?}"
  echo "▶ Submitting pkg to Apple notary (--wait)…"
  xcrun notarytool submit "$OUT" \
    --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait
  xcrun stapler staple "$OUT"
  spctl -a -vv --type install "$OUT" 2>&1 | grep -q "accepted" \
    && echo "✓ pkg notarized, stapled & Gatekeeper-accepted" \
    || echo "⚠ stapled but spctl did not accept — check manually."
fi
