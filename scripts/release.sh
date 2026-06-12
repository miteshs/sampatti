#!/usr/bin/env bash
# Cut a PUBLIC Sampatti release and prepare the Homebrew cask.
#
#   scripts/release.sh                 # public build (NO relay token), sha256, update the cask
#   scripts/release.sh --gh-release    # also publish the GitHub Release on miteshs/sampatti-releases
#   scripts/release.sh --tap ../homebrew-sampatti   # also copy the cask into a tap checkout
#
# Notes:
#   • Version comes from src-tauri/tauri.conf.json.
#   • PUBLIC builds bake an EMPTY VITE_RELAY_TOKEN: anyone can download the dmg, so it must
#     not carry the relay app-token (that would let strangers spend the relay owner's API
#     credits). Public users add their own Anthropic key on the Privacy screen.
#     → After cutting a release, rebuild WITHOUT the override (plain `npm run tauri build`,
#       which reads .env.local) before reinstalling YOUR OWN /Applications copy.
#   • The dmg is Apple-Silicon only and (today) unsigned/un-notarized — see docs/homebrew.md.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# MUTUAL EXCLUSION: a concurrent `npm run tauri build` (personal, token-ful) once rewrote
# dist/ mid-release and contaminated the public bundle — caught by the token grep below,
# but don't even allow the race. (A binary-level grep is NOT used: Tauri brotli-compresses
# embedded assets, so `strings` can't see the token; the dist grep after a solo build is
# the sound check.)
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

# Signing + notarization are fully handled by Tauri when the env vars exist — source them
# from the gitignored .env.signing (see .env.signing.example). Absent → unsigned, as before.
SIGNED=0
if [ -f .env.signing ]; then
  set -a; . ./.env.signing; set +a
  if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
    SIGNED=1
    echo "▶ Signing as: $APPLE_SIGNING_IDENTITY (notarization via Tauri)"
  fi
fi
[ "$SIGNED" = "1" ] || echo "⚠ UNSIGNED build (no .env.signing) — the cask postflight strips quarantine instead."

echo "▶ Building PUBLIC Sampatti ${VERSION} (relay token excluded)…"
# Strip the build machine's identity: Rust dependencies embed absolute panic/debug paths
# (/Users/<name>/.cargo/…) into release binaries — 749 of them in the first 0.3.0 cut.
# Remap everything under $HOME for rustc and for the C/C++ in llama.cpp alike.
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$HOME=/build"
export CFLAGS="${CFLAGS:-} -ffile-prefix-map=$HOME=/build"
export CXXFLAGS="${CXXFLAGS:-} -ffile-prefix-map=$HOME=/build"
VITE_RELAY_TOKEN="" npm run tauri build >/dev/null
[ -f "$DMG" ] || { echo "✗ dmg not found at $DMG"; exit 1; }

# Binary-level PII gate: the published executable must not contain the builder's home path.
if strings "$APP/Contents/MacOS/sampatti" | grep -q "/Users/"; then
  echo "✗ ABORT: build paths leak the build machine's identity — check the remap flags."
  exit 1
fi

# Belt & braces: the published bundle must not contain the relay token from .env.local.
if [ -f .env.local ]; then
  TOKEN=$(sed -n 's/^VITE_RELAY_TOKEN=//p' .env.local | tr -d '"' | tr -d "'")
  if [ -n "$TOKEN" ] && grep -rqs "$TOKEN" dist/assets 2>/dev/null; then
    echo "✗ ABORT: relay token found in the built bundle — refusing to release."
    exit 1
  fi
fi

# When signed, prove it before publishing: Gatekeeper assessment + stapled notarization
# ticket. Fail the release rather than ship a half-signed artifact.
if [ "$SIGNED" = "1" ]; then
  spctl -a -vv "$APP" 2>&1 | grep -q "accepted" || { echo "✗ spctl did not accept the app — not releasing."; exit 1; }
  xcrun stapler validate "$DMG" >/dev/null 2>&1 || xcrun stapler validate "$APP" >/dev/null 2>&1 \
    || { echo "✗ no stapled notarization ticket — not releasing."; exit 1; }
  echo "✓ Signed, notarized & stapled (spctl accepted)"
  echo "  → once this release ships, DELETE the postflight block from the cask."
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
  gh release create "v${VERSION}" "$DMG" \
    --repo "$RELEASES_REPO" \
    --title "Sampatti ${VERSION}" \
    --notes "macOS (Apple Silicon): \`brew tap miteshs/sampatti && brew install --cask sampatti\`. Windows (x64): the \`*-setup.exe\` below (SmartScreen → More info → Run anyway). AI analysis needs your own Anthropic API key (Privacy screen → stored in the macOS Keychain / Windows Credential Manager). All portfolio data stays on your device. Built from \`${BUILT_FROM}\`." \
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
echo "  • Push the tap:    cd <tap checkout> && git commit -am 'sampatti ${VERSION}' && git push"
echo "  • Users install:   brew tap miteshs/sampatti && brew install --cask sampatti"
echo "  • Your own copy:   npm run tauri build   (re-bakes the relay token from .env.local)"
