# Installing Sampatti with Homebrew

User flow (macOS, Apple Silicon):

```sh
brew tap miteshs/sampatti          # adds github.com/miteshs/homebrew-sampatti
brew install --cask sampatti
```

## How distribution is laid out (decided June 2026)

Three repos, only the last two public — the source stays private:

| Repo | Visibility | Holds |
|---|---|---|
| `miteshs/sampatti` | **private** | the source (this repo) + `packaging/homebrew/sampatti.rb` as the cask's source of truth |
| `miteshs/sampatti-releases` | public | GitHub Releases with the dmg artifacts only (brew needs a public, unauthenticated URL) |
| `miteshs/homebrew-sampatti` | public | the tap: `Casks/sampatti.rb` |

**Public builds carry no relay token.** The hosted-relay app-token (`VITE_RELAY_TOKEN`) is
deliberately baked as empty by `scripts/release.sh`, because anything inside a public dmg is
extractable — shipping the token would let anyone spend the relay owner's Anthropic credits.
Public users add their **own** Anthropic key on the Privacy screen (stored in the macOS
Keychain); the app shows exactly that hint if a relay call comes back 401/403. Your personal
build (`npm run tauri build`, which reads `.env.local`) still includes relay access.

## Cutting a release

```sh
# 1. Bump version in src-tauri/tauri.conf.json (and package.json if you keep them in sync).
# 2. Public build + sha256 + cask update + publish the GitHub release:
scripts/release.sh --gh-release

# 3. Update the tap (any checkout location works):
git clone https://github.com/miteshs/homebrew-sampatti /tmp/homebrew-sampatti  # if not already
scripts/release.sh --tap /tmp/homebrew-sampatti     # copies the cask in
cd /tmp/homebrew-sampatti && git commit -am "sampatti <version>" && git push

# 4. Rebuild your OWN copy with relay access and reinstall it:
npm run tauri build
cp -R src-tauri/target/release/bundle/macos/Sampatti.app /Applications/
```

Verify the public path without clobbering your local install:

```sh
brew tap miteshs/sampatti
brew fetch --cask sampatti     # downloads from the public URL and checks the sha256
```

## Signing + notarization (the remaining gap)

The build is **unsigned and un-notarized**, so the cask carries a `postflight` that strips
`com.apple.quarantine` after install. It works, but the first-class experience is an Apple
Developer ID ($99/yr) + `notarytool`:

- Set `bundle.macOS.signingIdentity` in `src-tauri/tauri.conf.json` and notarize the dmg.
- Then **delete the `postflight` block** from the cask.

## Notes / limits

- Apple-Silicon only (`aarch64`). Intel/universal would add an `on_intel` block + second sha.
- `brew uninstall --cask sampatti` removes the app; `--zap` also deletes the on-device
  portfolio under `~/Library/Application Support/app.sampatti.desktop`.
- The full install path (download → install → quarantine strip → launch) was validated locally
  via a `file://` tap before publishing; the public URL + sha are validated with `brew fetch`.
