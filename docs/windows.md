# Sampatti on Windows

The Windows build is the same app as the macOS one — same on-device parsing, same
privacy posture. Platform differences, all handled automatically:

| | macOS | Windows |
|---|---|---|
| Installer | `.dmg` (direct download, signed + notarized) | `Sampatti_<version>_x64-setup.exe` (NSIS, per-user — no admin prompt) |
| BYO Anthropic key | macOS Keychain | Windows Credential Manager |
| Data file | `~/Library/Application Support/app.sampatti.desktop/portfolio.json` | `%APPDATA%\app.sampatti.desktop\portfolio.json` |
| Disk encryption advice | FileVault | Device encryption / BitLocker |
| Webview | WKWebView (system) | WebView2 (Windows 11 ships it; the installer fetches it on Windows 10) |

## Install (users)

1. Download `Sampatti_<version>_x64-setup.exe` from the
   [releases page](https://github.com/miteshs/sampatti-releases/releases).
2. Run it. The build is unsigned, so SmartScreen shows a blue box once. Click
   **More info**, then the **Run anyway** button that appears.
3. It installs per-user (no administrator rights needed) and adds a Start-menu entry.
4. First-run setup is the same as macOS — see [getting-started.md](getting-started.md):
   paste your **access code** in *Settings → Access code*, or enable Developer mode to add
   your own Anthropic API key (stored in the **Windows Credential Manager**, never in a file).

Uninstall: Settings → Apps, like any other program. Your data file (see table above) is
left behind unless you use **Erase all data** in the app first.

### Is this safe? (why SmartScreen warns, and how to verify)

The warning means "unsigned," not "unsafe" — a code-signing certificate costs money and this
project doesn't buy one. Instead, every release ships proof you can check yourself, all
attached to the [release](https://github.com/miteshs/sampatti-releases/releases):

- **Checksum** — confirm the download wasn't corrupted or swapped. In PowerShell:
  ```powershell
  certutil -hash Sampatti_<version>_x64-setup.exe SHA256
  ```
  Compare the result to the value in `SHA256SUMS-windows.txt` on the release.
- **VirusTotal** — the release notes link a scan across ~70 antivirus engines.
- **Build provenance** — the `.exe` was built by public GitHub Actions straight from source,
  not uploaded by hand. With the [GitHub CLI](https://cli.github.com/) you can verify the
  cryptographic attestation against the bundle on the release:
  ```sh
  gh attestation verify Sampatti_<version>_x64-setup.exe \
    --bundle Sampatti_<version>_x64-setup.exe.sigstore.json --repo miteshs/sampatti
  ```

None of this removes the SmartScreen prompt — only a paid certificate does — but it lets a
careful user confirm exactly what they're running.

## Cutting a Windows release (maintainer)

The installer is built by CI — [`.github/workflows/windows-release.yml`](../.github/workflows/windows-release.yml)
on `windows-latest`. No secret is baked into any build — hosted-relay access is a user-entered
access code, not a build-time token — so Windows artifacts are public-by-construction.

One-time setup:

- Create a **fine-grained PAT** with *Contents: Read and write* on `miteshs/sampatti-releases`
  only, and save it as the `RELEASES_TOKEN` actions secret on `miteshs/sampatti`.
- *(Optional)* Add a `VT_API_KEY` actions secret — a free [VirusTotal](https://www.virustotal.com/)
  account's API key — so CI scans each build and links the report in the release notes. Absent
  this secret the scan step just no-ops; the rest of the release is unaffected.
- After the first public release, **submit the installer to Microsoft** as the developer at
  the [Defender SmartScreen submission portal](https://www.microsoft.com/wdsi/filesubmission)
  (choose "I'm a software developer" → "Incorrectly detected"). This asks Microsoft to vet the
  file as clean and helps it accrue SmartScreen reputation faster. Re-submit when the hash
  changes (i.e. each release) if you want the warning to ease over time.

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
- **SmartScreen**: accepted friction — code-signing certificates cost money (the macOS build,
  by contrast, *is* signed + notarized). Rather than pay, each release ships a transparency
  bundle — SHA-256 checksum, VirusTotal link, and a GitHub build-provenance attestation — so
  the warning is verifiable rather than scary (see the "Is this safe?" section above).
  Reputation also accrues to unsigned installers over download volume, helped by the
  SmartScreen developer submission.
- **winget**: worth a manifest once downloads justify it; direct `.exe` first.
