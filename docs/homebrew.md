# Installing Sampatti with Homebrew

Goal: `brew install --cask sampatti` on macOS (Apple Silicon).

There's no separate "Homebrew package" format for a GUI app — you ship a **cask** (which
points at a downloadable `.dmg`/`.zip` and installs the `.app`) from a **tap** (a GitHub repo
named `homebrew-<name>`). So the user flow is:

```sh
brew tap miteshs/sampatti          # adds github.com/miteshs/homebrew-sampatti
brew install --cask sampatti
```

The cask itself lives at [`packaging/homebrew/sampatti.rb`](../packaging/homebrew/sampatti.rb)
in this repo as the source of truth; `scripts/release.sh` fills in the version + sha256 and can
copy it into the tap repo.

## What has to be true for this to work for other people

1. **A public download URL for the dmg.** Homebrew fetches the artifact over plain HTTPS with
   no auth, so the dmg must be public. Options:
   - **GitHub Release on a public repo** — simplest. Either make `miteshs/sampatti` public, or
     create a small **public** repo (e.g. `miteshs/sampatti-releases`) that holds only the dmg
     releases and point the cask `url` there. (A private repo's release assets need a token and
     won't work with a plain `brew install`.)
   - **Any public bucket/CDN** (Cloudflare R2, S3, GitHub Pages) hosting the dmg.
   The cask `url` in `packaging/homebrew/sampatti.rb` currently assumes a GitHub Release on
   `miteshs/sampatti` — change it if you host elsewhere.

2. **Signing + notarization (recommended).** The build today is **unsigned and un-notarized**.
   macOS Gatekeeper will quarantine an unsigned download, so the cask includes a `postflight`
   that runs `xattr -dr com.apple.quarantine` to let it launch. That works, but the *proper*
   fix — and what makes `brew install` feel first-class — is to sign with an **Apple Developer
   ID** ($99/yr) and **notarize**:
   - Add the cert to the keychain and set Tauri signing in `src-tauri/tauri.conf.json`
     (`bundle.macOS.signingIdentity`) + notarize with `notarytool`.
   - Once notarized, **delete the `postflight` block** from the cask (no longer needed).

   The tap repo can stay public regardless; only the code repo's visibility is a separate
   decision.

## Cutting a release

```sh
# Local: build the dmg, compute its sha256, update packaging/homebrew/sampatti.rb
scripts/release.sh

# Also create the GitHub Release and upload the dmg (needs the repo's releases to be public
# for brew to fetch them):
scripts/release.sh --gh-release

# Also drop the updated cask into a checked-out tap repo:
scripts/release.sh --gh-release --tap ../homebrew-sampatti
```

Then in the tap repo (`miteshs/homebrew-sampatti`), commit `Casks/sampatti.rb` and push.

## Creating the tap repo (one-time)

```sh
# scaffold locally
brew tap-new miteshs/sampatti
# this creates a repo dir under $(brew --repository)/Library/Taps/miteshs/homebrew-sampatti
# put Casks/sampatti.rb there (scripts/release.sh --tap can do this), then:
#   create github.com/miteshs/homebrew-sampatti (public) and push.
```

Users on a different Mac then just `brew tap miteshs/sampatti && brew install --cask sampatti`.

## Notes / limits

- The dmg is **Apple-Silicon only** (`aarch64`). For Intel Macs you'd add an `x86_64` build (or
  a universal binary) and a second `sha256`/`url` (cask `on_arm` / `on_intel` blocks).
- `brew uninstall --cask sampatti` removes the app; `--zap` also deletes the on-device
  portfolio under `~/Library/Application Support/app.sampatti.desktop`.
- The full `brew install --cask` path (download → install → quarantine strip → launch) was
  validated locally against a tap using a `file://` url to the built dmg.
