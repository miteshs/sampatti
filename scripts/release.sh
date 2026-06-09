#!/usr/bin/env bash
# Cut a Sampatti release and prepare the Homebrew cask.
#
#   scripts/release.sh                 # build dmg, compute sha256, update the cask locally
#   scripts/release.sh --gh-release    # also create the GitHub Release and upload the dmg
#   scripts/release.sh --gh-release --tap ../homebrew-sampatti   # also copy cask into a tap
#
# Notes:
#   • Version comes from src-tauri/tauri.conf.json.
#   • The dmg is Apple-Silicon only and (today) unsigned/un-notarized — see docs/homebrew.md.
#   • This never makes anything public on its own beyond what you pass: plain run is local-only.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

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
CASK="packaging/homebrew/sampatti.rb"

echo "▶ Building Sampatti ${VERSION} (this runs npm run build + a Rust release build)…"
npm run tauri build >/dev/null
[ -f "$DMG" ] || { echo "✗ dmg not found at $DMG"; exit 1; }

SHA=$(shasum -a 256 "$DMG" | awk '{print $1}')
SIZE=$(du -h "$DMG" | awk '{print $1}')
echo "✓ Built $DMG ($SIZE)"
echo "  sha256: $SHA"

# Update the cask in place (version + sha256).
/usr/bin/sed -i '' -E "s/^  version \".*\"/  version \"${VERSION}\"/" "$CASK"
/usr/bin/sed -i '' -E "s/^  sha256 \".*\"/  sha256 \"${SHA}\"/" "$CASK"
echo "✓ Updated $CASK"

if [ "$GH_RELEASE" = "1" ]; then
  echo "▶ Creating GitHub release v${VERSION} and uploading the dmg…"
  gh release create "v${VERSION}" "$DMG" \
    --title "Sampatti ${VERSION}" \
    --notes "Apple-Silicon build. Install: brew install --cask sampatti (after tapping miteshs/sampatti)." \
    || gh release upload "v${VERSION}" "$DMG" --clobber
  echo "✓ Release v${VERSION} ready"
fi

if [ -n "$TAP_DIR" ]; then
  mkdir -p "$TAP_DIR/Casks"
  cp "$CASK" "$TAP_DIR/Casks/sampatti.rb"
  echo "✓ Copied cask into $TAP_DIR/Casks/sampatti.rb (commit & push that tap repo)"
fi

echo
echo "Next:"
echo "  • Verify locally:  brew install --cask ./$CASK   (needs the url reachable, or use a file:// url)"
echo "  • Publish:         push the dmg to a PUBLIC location and the cask to miteshs/homebrew-sampatti"
echo "  • Users then:      brew tap miteshs/sampatti && brew install --cask sampatti"
