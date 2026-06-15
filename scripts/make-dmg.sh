#!/usr/bin/env bash
# Build an APP-ONLY .dmg — just Sampatti.app, no "Applications" drag alias and no drag-here
# background. The mounted window then shows a single app icon, so the obvious (only) action is to
# double-click it, which triggers the self-install in src-tauri/src/relocate.rs (move to
# /Applications + relaunch). Tauri's own dmg always injects the Applications alias, so we build
# the dmg ourselves with hdiutil instead.
#
#   scripts/make-dmg.sh <Sampatti.app> <out.dmg> [signing-identity]
set -euo pipefail

APP="${1:?usage: make-dmg.sh <app> <out.dmg> [identity]}"
OUT="${2:?usage: make-dmg.sh <app> <out.dmg> [identity]}"
IDENTITY="${3:-}"

[ -d "$APP" ] || { echo "✗ app bundle not found: $APP"; exit 1; }

STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
# UDZO = compressed, read-only. volname is what shows in the title bar / Finder sidebar.
hdiutil create -volname "Sampatti" -srcfolder "$STAGE" -ov -format UDZO "$OUT" >/dev/null

# Sign the disk image (parity with Tauri's signed dmg). The app inside is already signed; this
# just signs the container, which Gatekeeper/notarization treat as a unit.
if [ -n "$IDENTITY" ]; then
  codesign --force --sign "$IDENTITY" "$OUT"
fi

echo "✓ Built app-only dmg: $OUT"
