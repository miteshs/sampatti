// Self-install ("LetsMove"): when the app is launched from a transient location — a mounted .dmg,
// the Downloads/Desktop folder, or a Gatekeeper App-Translocation path — rather than from
// /Applications, offer to move it into /Applications and relaunch from there. This is the
// "double-click the dmg and it just installs" flow people expect, with NO admin password (it's a
// per-user copy, not a system pkg). No-op once it already lives in /Applications, and a no-op on
// every non-macOS platform. Runs before any window appears.

// Pure classifier: the destination in /Applications, or None when no move is warranted (already
// installed, or running from a normal/dev location). Split out so it can be unit-tested.
#[cfg(target_os = "macos")]
fn relocation_target(bundle_path: &str) -> Option<String> {
    if bundle_path.starts_with("/Applications/") {
        return None; // already installed
    }
    // Only the locations a freshly-downloaded app is run from. A built app sitting in the repo's
    // target/ dir is deliberately NOT transient, so development is never interrupted.
    let transient = bundle_path.starts_with("/Volumes/")          // mounted dmg
        || bundle_path.contains("/AppTranslocation/")             // quarantined → randomized path
        || bundle_path.contains("/Downloads/")
        || bundle_path.contains("/Desktop/");
    if !transient {
        return None;
    }
    let name = std::path::Path::new(bundle_path).file_name()?.to_str()?;
    Some(format!("/Applications/{name}"))
}

#[cfg(target_os = "macos")]
pub fn maybe_relocate_to_applications() {
    use std::process::Command;

    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(_) => return,
    };
    // current_exe is <bundle>/Contents/MacOS/<bin>; walk up to the enclosing .app bundle.
    let bundle = match exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")) {
        Some(b) => b.to_path_buf(),
        None => return, // not running from a bundle (e.g. `cargo run`)
    };
    let dest = match relocation_target(&bundle.to_string_lossy()) {
        Some(d) => d,
        None => return,
    };

    // Ask once, with a native dialog, before the app window appears.
    if !prompt_move() {
        return; // user declined → run in place
    }

    // Replace any existing install, then copy the running bundle in. `cp -R` works even from a
    // read-only translocated source. Any failure (e.g. /Applications not writable for a
    // non-admin user) → fall through and just run from the current location.
    let _ = std::fs::remove_dir_all(&dest);
    let copied = Command::new("/bin/cp")
        .arg("-R")
        .arg(&bundle)
        .arg("/Applications/")
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !copied {
        return;
    }

    // Clear quarantine on the installed copy so it opens without a prompt, launch it, and quit.
    let _ = Command::new("/usr/bin/xattr")
        .args(["-dr", "com.apple.quarantine"])
        .arg(&dest)
        .status();
    let _ = Command::new("/usr/bin/open").arg(&dest).status();
    std::process::exit(0);
}

#[cfg(target_os = "macos")]
fn prompt_move() -> bool {
    use std::process::Command;
    let script = r#"display dialog "Move Sampatti to your Applications folder? It keeps things tidy and lets the app update itself." with title "Install Sampatti" buttons {"Not Now", "Move to Applications"} default button "Move to Applications" with icon note"#;
    Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("Move to Applications"))
        .unwrap_or(false)
}

// On non-macOS targets the call site is compiled out; provide nothing here.

#[cfg(test)]
#[cfg(target_os = "macos")]
mod tests {
    use super::relocation_target;

    #[test]
    fn already_installed_is_skipped() {
        assert_eq!(relocation_target("/Applications/Sampatti.app"), None);
        assert_eq!(relocation_target("/Applications/Utilities/Sampatti.app"), None);
    }

    #[test]
    fn transient_locations_target_applications() {
        let want = Some("/Applications/Sampatti.app".to_string());
        assert_eq!(relocation_target("/Volumes/Sampatti 0.8.2/Sampatti.app"), want);
        assert_eq!(relocation_target("/home/ada/Downloads/Sampatti.app"), want);
        assert_eq!(relocation_target("/home/ada/Desktop/Sampatti.app"), want);
        assert_eq!(
            relocation_target("/private/var/folders/ab/cd/X/AppTranslocation/UUID/d/Sampatti.app"),
            want
        );
    }

    #[test]
    fn dev_and_other_locations_are_left_alone() {
        // A freshly built app in the repo's target dir must not trigger a move.
        assert_eq!(
            relocation_target("/opt/sampatti/src-tauri/target/release/bundle/macos/Sampatti.app"),
            None
        );
    }
}
