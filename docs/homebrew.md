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

## Signing + notarization — runbook (wired, awaiting enrollment)

The build ships **unsigned** today (cask `postflight` strips quarantine). Everything is
pre-wired so signing turns on the moment credentials exist — no config edits:

1. **Enroll** (only the owner can): developer.apple.com → Apple Developer Program,
   *individual*, $99/yr, Apple ID with 2FA. Approval is usually <48 h.
2. **Certificate**: Xcode → Settings → Accounts → Manage Certificates → **+** →
   *Developer ID Application*. Confirm with `security find-identity -v -p codesigning`.
3. **Notarization key** (recommended over Apple-ID/password): App Store Connect → Users and
   Access → Integrations → App Store Connect API → new key, role *Developer*. Download the
   `.p8` once, store it outside the repo (e.g. `~/.appstoreconnect/`).
4. **Credentials file**: `cp .env.signing.example .env.signing` and fill it in (gitignored).
5. **Release as usual**: `scripts/release.sh --gh-release --tap …`. Tauri signs with the
   hardened runtime, submits for notarization, and staples the ticket; the script then
   *verifies* (`spctl` must accept + stapled ticket present) and refuses to publish a
   half-signed artifact. Unsigned fallback still works when `.env.signing` is absent.
6. **First signed release shipped → delete the `postflight` block** from
   `packaging/homebrew/sampatti.rb` (and the tap copy). Gatekeeper then handles everything.

Notes: the first signed build changes the app's code signature, so macOS asks once to
re-authorize access to the saved Anthropic key in the Keychain. Notarization itself takes
~1–15 min inside the build.

## Notes / limits

- Apple-Silicon only (`aarch64`). Intel/universal would add an `on_intel` block + second sha.
- `brew uninstall --cask sampatti` removes the app; `--zap` also deletes the on-device
  portfolio under `~/Library/Application Support/app.sampatti.desktop`.
- The full install path (download → install → quarantine strip → launch) was validated locally
  via a `file://` tap before publishing; the public URL + sha are validated with `brew fetch`.
