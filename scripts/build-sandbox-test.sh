#!/usr/bin/env bash
# EXPERIMENT (branch mas-app-sandbox): build a SANDBOXED Sampatti.app, signed with the
# Developer ID cert, to find out what breaks under the App Store sandbox BEFORE dealing with
# App Store Connect / provisioning. Developer-ID + app-sandbox runs sandboxed locally — the
# data container is created, file access goes through powerbox, keychain is per-app — which is
# 90% of what MAS review would exercise, at zero submission cost.
#
#   scripts/build-sandbox-test.sh
#
# Then test by hand: launch it, import a statement (file dialog), set a BYO key (keychain
# round-trip across relaunch), and — if you want — download/run the local model. Data lands in
#   ~/Library/Containers/app.sampatti.desktop/Data/Library/Application Support/…
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

[ -f .env.signing ] || { echo "✗ .env.signing missing (need APPLE_SIGNING_IDENTITY)."; exit 1; }
set -a; . ./.env.signing; set +a
: "${APPLE_SIGNING_IDENTITY:?set APPLE_SIGNING_IDENTITY in .env.signing}"
# Sign only — no notarization for a local sandbox test.
unset APPLE_API_KEY_PATH APPLE_API_KEY APPLE_API_ISSUER APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID

export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$HOME=/build"
export CFLAGS="${CFLAGS:-} -ffile-prefix-map=$HOME=/build"
export CXXFLAGS="${CXXFLAGS:-} -ffile-prefix-map=$HOME=/build"

echo "▶ Building SANDBOXED Sampatti.app (signed: $APPLE_SIGNING_IDENTITY)…"
rm -rf src-tauri/target/release/bundle/macos
npm run tauri build -- --config src-tauri/tauri.sandbox.conf.json

APP="src-tauri/target/release/bundle/macos/Sampatti.app"
[ -d "$APP" ] || { echo "✗ $APP not built"; exit 1; }

echo "=== embedded entitlements (must show app-sandbox = true) ==="
codesign -d --entitlements - --xml "$APP" 2>/dev/null | plutil -p - 2>/dev/null \
  | grep -E "app-sandbox|network.client|files.user-selected|keychain-access" || true
echo "=== signature valid? ==="
codesign --verify --strict --verbose=1 "$APP" 2>&1 | tail -2 || true
echo
echo "✓ Built $APP — launch it and exercise import / BYO key / local AI."
echo "  Sandbox container: ~/Library/Containers/app.sampatti.desktop/"
