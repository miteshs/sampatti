# Sampatti on Windows

The Windows build is the same app as the macOS one — same on-device parsing, same
privacy posture. Platform differences, all handled automatically:

| | macOS | Windows |
|---|---|---|
| Installer | `.dmg` (Homebrew cask or direct) | `Sampatti_<version>_x64-setup.exe` (NSIS, per-user — no admin prompt) |
| BYO Anthropic key | macOS Keychain | Windows Credential Manager |
| Data file | `~/Library/Application Support/app.sampatti.desktop/portfolio.json` | `%APPDATA%\app.sampatti.desktop\portfolio.json` |
| Disk encryption advice | FileVault | Device encryption / BitLocker |
| Webview | WKWebView (system) | WebView2 (Windows 11 ships it; the installer fetches it on Windows 10) |

## Install (users)

1. Download `Sampatti_<version>_x64-setup.exe` from the
   [releases page](https://github.com/miteshs/sampatti-releases/releases).
2. Run it. The build is unsigned, so SmartScreen will object once:
   **More info → Run anyway**.
3. It installs per-user (no administrator rights needed) and adds a Start-menu entry.
4. First-run setup is the same as macOS — see [getting-started.md](getting-started.md):
   add your own Anthropic API key on the **Privacy** tab (stored in the **Windows
   Credential Manager**, never in a file).

Uninstall: Settings → Apps, like any other program. Your data file (see table above) is
left behind unless you use **Erase all data** in the app first.

## Cutting a Windows release (maintainer)

The installer is built by CI — [`.github/workflows/windows-release.yml`](../.github/workflows/windows-release.yml)
on `windows-latest`. There is no relay token anywhere in CI (`.env.local` is gitignored and
the workflow pins `VITE_RELAY_TOKEN=""`), so Windows artifacts are public-by-construction.

One-time setup:

- Create a **fine-grained PAT** with *Contents: Read and write* on `miteshs/sampatti-releases`
  only, and save it as the `RELEASES_TOKEN` actions secret on `miteshs/sampatti`.

Release flow (after the usual macOS `scripts/release.sh --gh-release`):

```sh
git tag v<version>          # must equal the version in src-tauri/tauri.conf.json (CI enforces)
git push origin v<version>  # → CI tests, builds the NSIS exe, uploads it to the same release
```

Click-test build without releasing anything: GitHub → Actions → **windows-release** →
*Run workflow*. The `.exe` lands on the run as an artifact — install it in a Windows 11 VM.

What CI runs before bundling: `npm test`, `tsc -b` (via `npm run build`), and `cargo test` —
which includes a **real Credential Manager round-trip** on the runner, so a keystore
regression (see below) fails the release, not the user.

## Porting notes (why these choices)

- **keyring v3 feature flags are load-bearing.** Without `windows-native` / `apple-native`
  in `src-tauri/Cargo.toml`, keyring silently substitutes an in-memory mock store and the
  saved key evaporates. `cargo test` pins the backend's persistence as `UntilDelete`.
- **NSIS over MSI**: per-user install, no UAC, and Tauri's recommended Windows target.
  `src-tauri/tauri.windows.conf.json` pins the bundle targets to `nsis` on Windows, so a
  plain `npm run tauri build` does the right thing there (macOS keeps `dmg`/`app`).
- **SmartScreen**: accepted friction — code-signing certificates cost money and the macOS
  build is in the same (unsigned) boat today. Reputation also accrues to unsigned
  installers over download volume.
- **winget**: worth a manifest once downloads justify it; direct `.exe` first.
