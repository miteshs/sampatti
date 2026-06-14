# Releasing Sampatti for macOS

Sampatti for macOS ships as a **signed + notarized `.dmg`** that users download directly from
the public releases repo, open, and drag into *Applications* — no Homebrew, no Gatekeeper
prompts, no install scripts.

User flow:

> Download `Sampatti_<version>_aarch64.dmg` from
> [the releases page](https://github.com/miteshs/sampatti-releases/releases) → open it → drag
> **Sampatti** into *Applications* → launch.

## How distribution is laid out

The source stays private; only the releases repo is public:

| Repo | Visibility | Holds |
|---|---|---|
| `miteshs/sampatti` | **private** | the source (this repo) |
| `miteshs/sampatti-releases` | public | GitHub Releases with the installers only — macOS `.dmg` + Windows `-setup.exe` |

(The Windows installer is built and uploaded by CI on tag push — see
[windows.md](windows.md); this doc is the macOS release leg.)

**Public builds carry no relay token.** The hosted-relay app-token (`VITE_RELAY_TOKEN`) is
deliberately baked as empty by `scripts/release.sh`, because anything inside a public dmg is
extractable — shipping the token would let anyone spend the relay owner's Anthropic credits.
Public users add their **own** Anthropic key on the Settings screen (stored in the macOS
Keychain); the app shows exactly that hint if a relay call comes back 401/403. Your personal
build (`npm run tauri build`, which reads `.env.local`) still includes relay access.

## Cutting a release

```sh
# 1. Bump the version in package.json, src-tauri/Cargo.toml (+ Cargo.lock), and
#    src-tauri/tauri.conf.json — they must all match.
# 2. Public build → sign → notarize → staple → verify → publish the GitHub release:
scripts/release.sh --gh-release

# 3. Windows leg — push the version tag; CI adds the NSIS exe to the same release:
git tag v<version> && git push origin v<version>    # see docs/windows.md

# 4. Rebuild your OWN copy with relay access and reinstall it:
npm run tauri build
cp -R src-tauri/target/release/bundle/macos/Sampatti.app /Applications/
```

`scripts/release.sh` refuses a dirty tree (every release maps to a commit), strips the build
machine's home path from the binary, and aborts if the relay token leaks into the bundle.

## Signing + notarization

Signing is **active**: `scripts/release.sh` signs with the Developer ID, notarizes, staples the
ticket, then *verifies* (`spctl` must accept + a stapled ticket must be present) and refuses to
publish a half-signed artifact. Credentials live in a gitignored `.env.signing` (see
[`.env.signing.example`](../.env.signing.example)); if that file is absent the build falls back
to unsigned, exactly as before.

To set up signing on a new machine:

1. **Certificate**: Xcode → Settings → Accounts → Manage Certificates → **+** →
   *Developer ID Application* (needs the paid Apple Developer Program). Confirm with
   `security find-identity -v -p codesigning`.
2. **Notarization key**: App Store Connect → Users and Access → Integrations → App Store
   Connect API → new key, role *Developer*. Download the `.p8` once, store it outside the repo
   (e.g. `~/.appstoreconnect/`, `chmod 600`). Note the **Key ID** and the **Issuer ID**.
3. **Credentials file**: `cp .env.signing.example .env.signing` and fill in the identity
   string, issuer, key id, and key path.

Notes: the first signed build changes the app's code signature, so macOS asks once to
re-authorize access to the saved Anthropic key in the Keychain. Notarization itself runs inside
the build and usually takes ~1–15 min (the *first* submission on a new key can be slower while
Apple's service processes it).

## Notes / limits

- Apple-Silicon only (`aarch64`). Intel/universal would add a second arch + sha.
- The app stores its data under `~/Library/Application Support/app.sampatti.desktop`; deleting
  the app does not remove it — delete that folder to wipe the on-device portfolio.

## Legacy: Homebrew

Earlier releases were distributed via a Homebrew tap (`miteshs/homebrew-sampatti`). Direct
download is now the only recommended path. The cask source still lives at
`packaging/homebrew/sampatti.rb` and `scripts/release.sh` keeps its version/sha current, but
the tap is no longer actively published. Existing `brew`-installed users can switch by deleting
the old app and downloading the dmg.
