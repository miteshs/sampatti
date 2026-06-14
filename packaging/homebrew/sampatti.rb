# Homebrew Cask for Sampatti (macOS, Apple Silicon).
#
# This is the cask that lives in a tap repo so users can:
#     brew tap miteshs/sampatti
#     brew install --cask sampatti
#
# It is kept in this repo as the source of truth; `scripts/release.sh` builds the dmg,
# computes its sha256, fills in the fields below, and (optionally) copies it into the tap
# repo `miteshs/homebrew-sampatti` (Casks/sampatti.rb).
#
# NOTES (see docs/homebrew.md):
#   1. The dmg is served from the PUBLIC releases-only repo miteshs/sampatti-releases —
#      the source repo stays private; brew can't fetch a private repo's assets anyway.
#   2. Public builds ship WITHOUT the hosted-relay token: users bring their own Anthropic
#      key (Privacy screen → macOS Keychain). Keeps strangers off the relay owner's bill.
#   3. The build is signed with an Apple Developer ID and notarized, so Gatekeeper accepts it
#      on first launch — no quarantine-stripping postflight needed. Direct download is now the
#      recommended install (see README); this cask is retained for legacy `brew` users.
cask "sampatti" do
  version "0.7.0"
  sha256 "e9c45d7078bc65c73baf6842bae4f750d19ab5c045868243819d455c7090a4ac" # set per-release by scripts/release.sh

  url "https://github.com/miteshs/sampatti-releases/releases/download/v#{version}/Sampatti_#{version}_aarch64.dmg"
  name "Sampatti"
  desc "Private, India-first portfolio analysis (Tauri desktop app)"
  homepage "https://github.com/miteshs/sampatti-releases"

  # The release artifact is an Apple-Silicon dmg.
  depends_on arch: :arm64
  depends_on macos: :big_sur

  app "Sampatti.app"

  uninstall quit: "app.sampatti.desktop"

  # `brew uninstall --zap` also removes the on-device portfolio + settings.
  zap trash: [
    "~/Library/Application Support/app.sampatti.desktop",
    "~/Library/Caches/app.sampatti.desktop",
    "~/Library/Saved Application State/app.sampatti.desktop.savedState",
    "~/Library/WebKit/app.sampatti.desktop",
  ]
end
