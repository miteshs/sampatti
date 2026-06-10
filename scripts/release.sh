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
VITE_RELAY_TOKEN="" npm run tauri build >/dev/null
[ -f "$DMG" ] || { echo "✗ dmg not found at $DMG"; exit 1; }

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
    --notes "Apple-Silicon build. Install: \`brew tap miteshs/sampatti && brew install --cask sampatti\`. AI analysis needs your own Anthropic API key (Privacy screen → stored in the macOS Keychain). All portfolio data stays on your device." \
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
echo "  • Push the tap:    cd <tap checkout> && git commit -am 'sampatti ${VERSION}' && git push"
echo "  • Users install:   brew tap miteshs/sampatti && brew install --cask sampatti"
echo "  • Your own copy:   npm run tauri build   (re-bakes the relay token from .env.local)"
