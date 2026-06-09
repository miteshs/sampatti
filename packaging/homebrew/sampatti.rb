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
# REQUIREMENTS for `brew install` to work for other people (see docs/homebrew.md):
#   1. The dmg must be downloadable from a PUBLIC url (a GitHub Release on a public repo, or
#      any public bucket). brew cannot fetch a private repo's release without a token.
#   2. The build is currently UNSIGNED + UN-NOTARIZED. The postflight below strips the
#      quarantine flag so it still launches, but the proper fix is an Apple Developer ID
#      signature + notarization (then the postflight can be removed).
cask "sampatti" do
  version "0.1.0"
  sha256 "e5d77fe467fac3df3ad01022a927f48f630947c952543a0d55723a9d90503165" # set per-release by scripts/release.sh

  url "https://github.com/miteshs/sampatti/releases/download/v#{version}/Sampatti_#{version}_aarch64.dmg"
  name "Sampatti"
  desc "Private, India-first portfolio analysis (Tauri desktop app)"
  homepage "https://github.com/miteshs/sampatti"

  # The release artifact is an Apple-Silicon dmg.
  depends_on arch: :arm64
  depends_on macos: ">= :catalina"

  app "Sampatti.app"

  # Unsigned build: remove the quarantine attribute so Gatekeeper doesn't block first launch.
  # Once the app is signed + notarized with an Apple Developer ID, delete this block.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Sampatti.app"],
                   sudo: false
  end

  uninstall quit: "app.sampatti.desktop"

  # `brew uninstall --zap` also removes the on-device portfolio + settings.
  zap trash: [
    "~/Library/Application Support/app.sampatti.desktop",
    "~/Library/Caches/app.sampatti.desktop",
    "~/Library/Saved Application State/app.sampatti.desktop.savedState",
    "~/Library/WebKit/app.sampatti.desktop",
  ]
end
