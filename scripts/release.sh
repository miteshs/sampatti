#!/usr/bin/env bash
# Cut a PUBLIC Sampatti release: signed + notarized dmg, published for direct download.
#
#   scripts/release.sh                 # public build (no baked secrets), sign+notarize, sha256
#   scripts/release.sh --gh-release    # also publish the GitHub Release on miteshs/sampatti-releases
#   scripts/release.sh --tap ../homebrew-sampatti   # (legacy) also copy the cask into a tap checkout
#
# Notes:
#   • Version comes from src-tauri/tauri.conf.json.
#   • NO secrets are baked into any build. Relay access is via the access code the user pastes
#     into Settings (matched against the worker's APP_TOKENS); BYO Anthropic keys live in the OS
#     keychain. So a downloaded dmg carries nothing a stranger could spend — and personal and
#     public builds are byte-identical in this respect.
#   • The dmg is Apple-Silicon only. It is signed (Developer ID) + notarized + stapled when
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
TAP_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --gh-release) GH_RELEASE=1 ;;
    --tap) TAP_DIR="${2:-}"; shift ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
  shift
done

VERSION=$(node -e "console.log(require('./src-tauri/tauri.conf.json').version)")
DMG="src-tauri/target/release/bundle/dmg/Sampatti_${VERSION}_aarch64.dmg"
APP="src-tauri/target/release/bundle/macos/Sampatti.app"
CASK="packaging/homebrew/sampatti.rb"

# A release must be reproducible from a commit: refuse a dirty tree and stamp the commit
# into the release notes. (0.3.0 shipped a 14:08 dmg for an end-of-day tree — the Settings
# tab existed in every screenshot and video but not in the binary anyone downloaded.)
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Working tree not clean — commit first; the release must map to a commit."; exit 1
fi
BUILT_FROM=$(git rev-parse --short HEAD)

# Thorough clean: a stale bundle must never be mistaken for (or shipped as) this cut.
rm -rf src-tauri/target/release/bundle dist

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

echo "▶ Building PUBLIC Sampatti ${VERSION} (no baked secrets)…"
# Strip the build machine's identity: Rust dependencies embed absolute panic/debug paths
# (/Users/<name>/.cargo/…) into release binaries — 749 of them in the first 0.3.0 cut.
# Remap everything under $HOME for rustc and for the C/C++ in llama.cpp alike.
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$HOME=/build"
export CFLAGS="${CFLAGS:-} -ffile-prefix-map=$HOME=/build"
export CXXFLAGS="${CXXFLAGS:-} -ffile-prefix-map=$HOME=/build"
npm run tauri build >/dev/null
[ -f "$DMG" ] || { echo "✗ dmg not found at $DMG"; exit 1; }

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

# Update the cask in place (version + sha256).
/usr/bin/sed -i '' -E "s/^  version \".*\"/  version \"${VERSION}\"/" "$CASK"
/usr/bin/sed -i '' -E "s/^  sha256 \".*\"/  sha256 \"${SHA}\"/" "$CASK"
echo "✓ Updated $CASK"

if [ "$GH_RELEASE" = "1" ]; then
  echo "▶ Publishing release v${VERSION} on ${RELEASES_REPO} (public, dmg-only repo)…"
  # Direct download is the only install path: signed + notarized dmg opens on a plain
  # double-click, no Gatekeeper dance.
  NOTES=$(cat <<NOTES_EOF
**macOS (Apple Silicon)** — download \`Sampatti_${VERSION}_aarch64.dmg\` below, open it, and drag **Sampatti** into Applications. The app is signed with an Apple Developer ID and notarized by Apple, so it opens normally — no security warnings, no right-click dance.

**Windows (x64)**: \`Sampatti_${VERSION}_x64-setup.exe\` below — SmartScreen will warn: **More info → Run anyway**.

AI analysis is optional. Nothing secret is baked into the app: to use the hosted relay, paste the **access code** you were given into **Settings → Access code**; or enable **Developer mode** to use your own Anthropic API key (stored in the macOS Keychain / Windows Credential Manager). All portfolio data stays on your device. Built from \`${BUILT_FROM}\`.
NOTES_EOF
)
  gh release create "v${VERSION}" "$DMG" \
    --repo "$RELEASES_REPO" \
    --title "Sampatti ${VERSION}" \
    --notes "$NOTES" \
    || gh release upload "v${VERSION}" "$DMG" --repo "$RELEASES_REPO" --clobber
  echo "✓ Release v${VERSION} ready on ${RELEASES_REPO}"
fi

if [ -n "$TAP_DIR" ]; then
  mkdir -p "$TAP_DIR/Casks"
  cp "$CASK" "$TAP_DIR/Casks/sampatti.rb"
  echo "✓ Copied cask into $TAP_DIR/Casks/sampatti.rb (commit & push that tap repo)"
fi

echo
echo "Next:"
echo "  • Windows build:   git tag v${VERSION} && git push origin v${VERSION}"
echo "                     (CI builds the NSIS exe and adds it to the same release — docs/windows.md)"
echo "  • Users install:   download the dmg from the release, open it, drag to Applications"
echo "                     (signed + notarized — opens with no Gatekeeper warning)"
echo "  • Your own copy:   npm run tauri build   (same token-less build; paste your access code in Settings)"
