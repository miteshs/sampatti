#!/usr/bin/env bash
# Cut a PUBLIC Sampatti release: signed + notarized dmg, published for direct download.
#
#   scripts/release.sh                 # public build (no baked secrets), sign+notarize, sha256
#   scripts/release.sh --gh-release    # also publish the GitHub Release on miteshs/sampatti-releases
#
# Notes:
#   • Version comes from src-tauri/tauri.conf.json.
#   • NO secrets are baked into any build. Relay access is via the access code the user pastes
#     into Settings (matched against the worker's APP_TOKENS); BYO Anthropic keys live in the OS
#     keychain. So a downloaded dmg carries nothing a stranger could spend — and personal and
#     public builds are byte-identical in this respect.
#   • The dmg is a UNIVERSAL binary (Intel x86_64 + Apple Silicon arm64) — one download runs
#     natively on every Mac. macOS picks the right slice at launch; the website needs no arch
#     detection (browsers can't reliably tell Intel from Apple Silicon anyway). It is signed
#     (Developer ID) + notarized + stapled when
#     .env.signing is present (see .env.signing.example); absent → unsigned, as before.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# MUTUAL EXCLUSION: don't let a concurrent `npm run tauri build` rewrite dist/ mid-release and
# ship a half-built bundle. (No secrets are baked in anymore, so there's no token to leak — but
# a clean, reproducible artifact still demands one build at a time.)
LOCK="/tmp/sampatti-release.lock.d"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "✗ Another build appears to be running ($LOCK held) — finish it first."; exit 1
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

RELEASES_REPO="miteshs/sampatti-releases"
GH_RELEASE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --gh-release) GH_RELEASE=1 ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
  shift
done

VERSION=$(node -e "console.log(require('./src-tauri/tauri.conf.json').version)")

# Universal build: both target slices must be installed or `tauri build --target
# universal-apple-darwin` fails partway through the (slow) build.
TARGET="universal-apple-darwin"
for T in x86_64-apple-darwin aarch64-apple-darwin; do
  rustup target list --installed 2>/dev/null | grep -qx "$T" \
    || { echo "✗ Missing Rust target $T — run: rustup target add $T"; exit 1; }
done

BUNDLE="src-tauri/target/${TARGET}/release/bundle"
DMG="${BUNDLE}/dmg/Sampatti_${VERSION}_universal.dmg"
APP="${BUNDLE}/macos/Sampatti.app"

# A release must be reproducible from a commit: refuse a dirty tree and stamp the commit
# into the release notes. (0.3.0 shipped a 14:08 dmg for an end-of-day tree — the Settings
# tab existed in every screenshot and video but not in the binary anyone downloaded.)
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Working tree not clean — commit first; the release must map to a commit."; exit 1
fi
BUILT_FROM=$(git rev-parse --short HEAD)

# Thorough clean: a stale bundle must never be mistaken for (or shipped as) this cut. Clear both
# the per-arch and the universal bundle dirs so nothing old survives.
rm -rf src-tauri/target/release/bundle "$BUNDLE" dist

# Signing is done by Tauri during the build (it reads APPLE_SIGNING_IDENTITY). Notarization is
# done HERE with notarytool after the build, NOT by Tauri's built-in notarizer — that wrapper has
# thrown spurious HTTP 401s even with creds that authenticate fine via notarytool directly. So we
# build SIGN-ONLY (keep APPLE_SIGNING_IDENTITY in the env, remove the APPLE_API_* / APPLE_ID vars
# so Tauri skips notarization), then `notarytool submit --wait` + staple the dmg below.
# Source creds from the gitignored .env.signing (see .env.signing.example). Absent → unsigned.
SIGNED=0
if [ -f .env.signing ]; then
  set -a; . ./.env.signing; set +a
  if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
    SIGNED=1
    NOTARY_KEY="${APPLE_API_KEY_PATH:-}"; NOTARY_KEY_ID="${APPLE_API_KEY:-}"; NOTARY_ISSUER="${APPLE_API_ISSUER:-}"
    unset APPLE_API_KEY_PATH APPLE_API_KEY APPLE_API_ISSUER APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
    echo "▶ Signing as: $APPLE_SIGNING_IDENTITY (sign-only build; notarize via notarytool)"
  fi
fi
[ "$SIGNED" = "1" ] || echo "⚠ UNSIGNED build (no .env.signing) — first launch needs right-click → Open."

# Auto-update signing: with createUpdaterArtifacts on, the build emits Sampatti.app.tar.gz + .sig
# when TAURI_SIGNING_PRIVATE_KEY is set. Key is gitignored at .tauri/updater.key (password-less).
UPDATER=0
if [ -f .tauri/updater.key ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat .tauri/updater.key)"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
  UPDATER=1
else
  echo "⚠ No .tauri/updater.key — building without auto-update artifacts."
fi

echo "▶ Building PUBLIC Sampatti ${VERSION} (no baked secrets)…"
# Strip the build machine's identity: Rust dependencies embed absolute panic/debug paths
# (/Users/<name>/.cargo/…) into release binaries — 749 of them in the first 0.3.0 cut.
# Remap everything under $HOME for rustc and for the C/C++ in llama.cpp alike.
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$HOME=/build"
export CFLAGS="${CFLAGS:-} -ffile-prefix-map=$HOME=/build"
export CXXFLAGS="${CXXFLAGS:-} -ffile-prefix-map=$HOME=/build"
npm run tauri build -- --target "$TARGET" >/dev/null
[ -d "$APP" ] || { echo "✗ app not built at $APP"; exit 1; }

# Prove the bundle really is universal — a single-arch slip would silently lock out half of users.
lipo -archs "$APP/Contents/MacOS/sampatti" 2>/dev/null | grep -q "x86_64" \
  && lipo -archs "$APP/Contents/MacOS/sampatti" 2>/dev/null | grep -q "arm64" \
  || { echo "✗ app binary is not universal (need both x86_64 + arm64): $(lipo -archs "$APP/Contents/MacOS/sampatti" 2>/dev/null)"; exit 1; }

# Build the dmg ourselves: app-only (no Applications drag alias) so a double-click on the app
# triggers the self-install (relocate.rs). Tauri's dmg target is disabled in tauri.conf.json.
scripts/make-dmg.sh "$APP" "$DMG" "${APPLE_SIGNING_IDENTITY:-}"
[ -f "$DMG" ] || { echo "✗ dmg not produced at $DMG"; exit 1; }

# Binary-level PII gate: the published executable must not contain the builder's home path.
if strings "$APP/Contents/MacOS/sampatti" | grep -q "/Users/"; then
  echo "✗ ABORT: build paths leak the build machine's identity — check the remap flags."
  exit 1
fi

# Notarize the dmg directly, then prove it before publishing: notary Accepted, stapled ticket,
# and Gatekeeper accepts the app. Fail the release rather than ship a half-notarized artifact.
if [ "$SIGNED" = "1" ]; then
  [ -n "${NOTARY_KEY:-}" ] && [ -n "${NOTARY_KEY_ID:-}" ] && [ -n "${NOTARY_ISSUER:-}" ] \
    || { echo "✗ notary creds (APPLE_API_*) missing from .env.signing — can't notarize."; exit 1; }
  echo "▶ Notarizing $DMG via notarytool (--wait; minutes once the account is warm)…"
  NLOG=$(mktemp)
  xcrun notarytool submit "$DMG" --key "$NOTARY_KEY" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER" --wait | tee "$NLOG"
  grep -q "status: Accepted" "$NLOG" || { echo "✗ notarization not Accepted — not releasing."; rm -f "$NLOG"; exit 1; }
  rm -f "$NLOG"
  xcrun stapler staple "$DMG" >/dev/null || { echo "✗ stapling the dmg failed — not releasing."; exit 1; }
  xcrun stapler validate "$DMG" >/dev/null 2>&1 || { echo "✗ no stapled ticket on the dmg — not releasing."; exit 1; }
  spctl -a -vv "$APP" 2>&1 | grep -q "accepted" || { echo "✗ spctl did not accept the app — not releasing."; exit 1; }
  echo "✓ Signed, notarized & stapled (spctl accepted)"
fi

# Artifact sanity: the bundled app must carry exactly the version being released.
PLIST_V=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || echo "?")
[ "$PLIST_V" = "$VERSION" ] || { echo "✗ Bundled app version $PLIST_V != $VERSION — not releasing."; exit 1; }

SHA=$(shasum -a 256 "$DMG" | awk '{print $1}')
SIZE=$(du -h "$DMG" | awk '{print $1}')
echo "✓ Built $DMG ($SIZE)"
echo "  sha256: $SHA"

# ---- Auto-update artifacts (macOS) ----
# The build wrote Sampatti.app.tar.gz + .sig (signed with the updater key). Publish the tarball
# under a versioned name plus latest.json — the manifest the running app polls at
# …/releases/latest/download/latest.json (endpoint in tauri.conf.json). The tarball is universal,
# so both darwin arches point at the same file: a universal app runs as arm64 on Apple Silicon
# (updater asks for darwin-aarch64) and as x86_64 on Intel (darwin-x86_64). The signature is over
# the tarball file, so it's identical for both. The Windows leg can add windows-x86_64 later.
UPD_ASSETS=()
if [ "$UPDATER" = "1" ]; then
  UPD_TGZ="${BUNDLE}/macos/Sampatti.app.tar.gz"
  UPD_SIG="${UPD_TGZ}.sig"
  if [ -f "$UPD_TGZ" ] && [ -f "$UPD_SIG" ]; then
    UPD_NAME="Sampatti_${VERSION}_universal.app.tar.gz"
    UPD_OUT="${BUNDLE}/macos/${UPD_NAME}"
    MANIFEST="${BUNDLE}/macos/latest.json"
    cp "$UPD_TGZ" "$UPD_OUT"
    SIGCONTENT=$(cat "$UPD_SIG")
    PUBDATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    UPD_URL="https://github.com/${RELEASES_REPO}/releases/download/v${VERSION}/${UPD_NAME}"
    cat > "$MANIFEST" <<JSON
{
  "version": "${VERSION}",
  "pub_date": "${PUBDATE}",
  "notes": "Update to Sampatti ${VERSION}. See the release page for details.",
  "platforms": {
    "darwin-aarch64": {
      "signature": "${SIGCONTENT}",
      "url": "${UPD_URL}"
    },
    "darwin-x86_64": {
      "signature": "${SIGCONTENT}",
      "url": "${UPD_URL}"
    }
  }
}
JSON
    UPD_ASSETS=("$UPD_OUT" "$MANIFEST")
    echo "✓ Updater manifest + tarball ready (${UPD_NAME})"
  else
    echo "⚠ createUpdaterArtifacts on but no .app.tar.gz produced — auto-update assets skipped."
  fi
fi

if [ "$GH_RELEASE" = "1" ]; then
  echo "▶ Publishing release v${VERSION} on ${RELEASES_REPO} (public, dmg-only repo)…"
  # The app-only dmg opens on a plain double-click and self-installs to /Applications — no
  # Gatekeeper dance, no drag.
  # Build the notes via a top-level heredoc into a temp file (NOT $(cat <<EOF …) — an apostrophe
  # in the body, e.g. "you're ready", makes bash mis-read the heredoc inside command substitution
  # as an opening single quote and die with "unexpected EOF". 0.8.3 hit exactly this.) Then pass
  # the file to gh with --notes-file.
  NOTES_FILE=$(mktemp)
  cat > "$NOTES_FILE" <<NOTES_EOF
Sampatti brings everything you own — across India and the US — into one private dashboard, with an AI analyst that reviews your portfolio whenever you ask. Your financial information stays on your own computer.

### Download

**Mac** (Intel or Apple Silicon): get **\`Sampatti_${VERSION}_universal.dmg\`** below. Open it, double-click Sampatti, and you're ready. New versions install themselves automatically.

**Windows** (64-bit): get **\`Sampatti_${VERSION}_x64-setup.exe\`** below and run it. For brand-new apps Windows may show a "Windows protected your PC" screen — choose **More info → Run anyway** to continue.

### Your data stays private

Everything lives on your device — nothing is uploaded or kept on a server. The AI portfolio review is optional; you turn it on in Settings.

<sub>Build \`${BUILT_FROM}\`</sub>
NOTES_EOF
  gh release create "v${VERSION}" "$DMG" ${UPD_ASSETS[@]+"${UPD_ASSETS[@]}"} \
    --repo "$RELEASES_REPO" \
    --title "Sampatti ${VERSION}" \
    --notes-file "$NOTES_FILE" \
    || gh release upload "v${VERSION}" "$DMG" ${UPD_ASSETS[@]+"${UPD_ASSETS[@]}"} --repo "$RELEASES_REPO" --clobber
  rm -f "$NOTES_FILE"
  echo "✓ Release v${VERSION} ready on ${RELEASES_REPO}"
  [ "$UPDATER" = "1" ] && echo "  → auto-update manifest live at …/releases/latest/download/latest.json"
fi

echo
echo "Next:"
echo "  • Windows build:   git tag v${VERSION} && git push origin v${VERSION}"
echo "                     (CI builds the NSIS exe and adds it to the same release — docs/windows.md)"
echo "  • Users install:   download the dmg, open it, double-click Sampatti (it self-installs to /Applications)"
echo "  • Your own copy:   npm run tauri build   (builds the .app; copy it to /Applications)"
