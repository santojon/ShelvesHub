// Unit tests for the `populate` module, extracted from populate.rs and attached
// via `#[cfg(test)] #[path = "tests/populate_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

use super::*;

#[test]
fn trusted_bundle_url_gate() {
    let good = "https://github.com/santojon/Deck-Shelves/releases/download/v3.3.1/index.iife.js";
    assert!(is_trusted_bundle_url(good));
    // Wrong owner / repo / host.
    assert!(!is_trusted_bundle_url(
        "https://github.com/evil/Deck-Shelves/releases/download/v1/index.iife.js"
    ));
    assert!(!is_trusted_bundle_url(
        "https://github.com/santojon/Other/releases/download/v1/index.iife.js"
    ));
    assert!(!is_trusted_bundle_url(
        "https://github.com.evil.com/santojon/Deck-Shelves/releases/download/v1/index.iife.js"
    ));
    // Not an IIFE bundle.
    assert!(!is_trusted_bundle_url(
        "https://github.com/santojon/Deck-Shelves/releases/download/v1/mal.exe"
    ));
    assert!(!is_trusted_bundle_url(
        "https://github.com/santojon/Deck-Shelves/releases/download/v1/index.js"
    ));
    // Query / fragment / traversal smuggling.
    assert!(!is_trusted_bundle_url(&format!("{good}?x=1")));
    assert!(!is_trusted_bundle_url(&format!("{good}#x")));
    assert!(!is_trusted_bundle_url(
        "https://github.com/santojon/Deck-Shelves/releases/download/../evil/index.iife.js"
    ));
}

#[test]
fn finds_iife_asset_url() {
    let json = r#"{"assets":[
        {"name":"deck-shelves-v1.zip","browser_download_url":"https://x/zip"},
        {"name":"index.iife.js","browser_download_url":"https://x/index.iife.js"}
    ]}"#;
    assert_eq!(
        find_iife_asset_url(json).as_deref(),
        Some("https://x/index.iife.js")
    );
}

/// A hub release asset as the API lists it, downloaded from `url`.
fn hub_asset(name: &str, url: &str) -> serde_json::Value {
    serde_json::json!({ "name": name, "browser_download_url": url })
}

#[test]
fn hub_update_finds_platform_package_in_priority_order() {
    let url = |name: &str| format!("{TRUSTED_HUB_PREFIX}v0.6.0-beta.1/{name}");
    let release = serde_json::json!({ "assets": [
        hub_asset("shelveshub-linux.tar.gz", &url("shelveshub-linux.tar.gz")),
        hub_asset("shelveshub-steamos.tar.gz", &url("shelveshub-steamos.tar.gz")),
        hub_asset("shelveshub-macos.tar.gz", &url("shelveshub-macos.tar.gz")),
    ]});
    // First name in the list wins; a missing preferred name falls back.
    assert_eq!(
        find_asset_url_by_names(
            &release,
            &["shelveshub-steamos.tar.gz", "shelveshub-linux.tar.gz"]
        ),
        Some(url("shelveshub-steamos.tar.gz"))
    );
    assert_eq!(
        find_asset_url_by_names(
            &release,
            &["shelveshub-windows.zip", "shelveshub-macos.tar.gz"]
        ),
        Some(url("shelveshub-macos.tar.gz"))
    );
    assert!(find_asset_url_by_names(&release, &["shelveshub-windows.zip"]).is_none());
    // The running OS always has at least one candidate name.
    assert!(!hub_package_candidates().is_empty());
}

#[test]
fn hub_update_takes_assets_only_from_its_own_release_downloads() {
    let name = "shelveshub-macos.tar.gz";
    for elsewhere in [
        format!("https://evil.example.com/{name}"),
        format!("https://github.com/evil/ShelvesHub/releases/download/v0.6.0/{name}"),
        format!("{TRUSTED_BUNDLE_PREFIX}v0.6.0/{name}"),
        format!("{TRUSTED_HUB_PREFIX}v0.6.0/other.tar.gz"),
        format!("{TRUSTED_HUB_PREFIX}v0.6.0/x/{name}"),
        format!("{TRUSTED_HUB_PREFIX}v0.6.0/{name}?x=1"),
        format!("{TRUSTED_HUB_PREFIX}../{name}"),
        format!("{TRUSTED_HUB_PREFIX}v1%2F/{name}"),
    ] {
        let release = serde_json::json!({ "assets": [hub_asset(name, &elsewhere)] });
        assert_eq!(
            find_asset_url_by_names(&release, &[name]),
            None,
            "{elsewhere}"
        );
    }
    // A checksum file outside the hub's releases is refused before anything is fetched.
    let release = serde_json::json!({ "assets": [
        hub_asset("SHA256SUMS", "https://evil.example.com/SHA256SUMS"),
    ]});
    let err = verify_release_archive(&release, name, Path::new("/x")).unwrap_err();
    assert!(err.contains("refusing update"), "unexpected error: {err}");
}

#[test]
fn trusted_bundle_url_gate_refuses_a_release_pointing_elsewhere() {
    // What download_latest_iife accepts from each channel's API answer.
    let foreign = r#"{"assets":[{"name":"index.iife.js",
        "browser_download_url":"https://evil.example.com/index.iife.js"}]}"#;
    assert!(trusted_iife_url(foreign, false).is_err());
    assert!(trusted_iife_url(&format!("[{foreign}]"), true).is_err());
    let pinned = format!(
        r#"{{"assets":[{{"name":"index.iife.js",
        "browser_download_url":"{TRUSTED_BUNDLE_PREFIX}v3.4.0/index.iife.js"}}]}}"#
    );
    let want = Ok(format!("{TRUSTED_BUNDLE_PREFIX}v3.4.0/index.iife.js"));
    assert_eq!(trusted_iife_url(&pinned, false), want);
    assert_eq!(trusted_iife_url(&format!("[{pinned}]"), true), want);
}

#[test]
fn stage_binary_swap_replaces_the_target_in_place() {
    let dir = std::env::temp_dir().join(format!("shelveshub-swaptest-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let exe = dir.join(if cfg!(windows) {
        "shelveshub.exe"
    } else {
        "shelveshub"
    });
    let new_bin = dir.join("downloaded");
    fs::write(&exe, b"OLD-BINARY-CONTENTS").unwrap();
    fs::write(&new_bin, b"NEW-BINARY-CONTENTS-1234567890").unwrap();

    stage_binary_swap(&new_bin, &exe).unwrap();

    // The target path now carries the new contents.
    assert_eq!(fs::read(&exe).unwrap(), b"NEW-BINARY-CONTENTS-1234567890");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&exe).unwrap().permissions().mode() & 0o111,
            0o111
        );
    }
    #[cfg(windows)]
    {
        // The running binary was moved aside for cleanup on next start.
        assert!(exe.with_extension("old").exists());
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn relaunch_line_runs_the_windows_task_and_falls_back_to_the_binary() {
    let exe = r"C:\Users\me\AppData\Local\ShelvesHub\shelveshub.exe";
    let win = relaunch_line(exe, true);
    assert_eq!(
        win,
        format!("timeout /t 2 >nul & schtasks /Run /TN ShelvesHub >nul 2>&1 || \"{exe}\"")
    );
    assert_eq!(
        relaunch_line("/opt/shelveshub/shelveshub", false),
        "sleep 2; exec \"/opt/shelveshub/shelveshub\""
    );
}

#[test]
fn executable_magic_recognized_for_this_os() {
    // The right magic for the compile target passes; obvious non-executables fail.
    #[cfg(target_os = "windows")]
    assert!(looks_like_executable(b"MZ\x90\x00"));
    #[cfg(target_os = "macos")]
    assert!(looks_like_executable(&[0xCF, 0xFA, 0xED, 0xFE, 0, 0]));
    #[cfg(target_os = "linux")]
    {
        // Linux now requires the ELF machine to match the running CPU.
        let m = elf_machine_for_arch(std::env::consts::ARCH).unwrap();
        assert!(looks_like_executable(&fake_elf(m)));
        // A bare ELF magic with no e_machine no longer passes on Linux.
        assert!(!looks_like_executable(&[0x7F, b'E', b'L', b'F', 0, 0]));
    }
    #[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
    assert!(looks_like_executable(&[0x7F, b'E', b'L', b'F', 0, 0]));
    assert!(!looks_like_executable(b"<!DOCTYPE html>"));
    assert!(!looks_like_executable(b""));
}

#[cfg(target_os = "linux")]
fn fake_elf(machine: u16) -> Vec<u8> {
    let mut h = vec![0u8; 64];
    h[0..4].copy_from_slice(b"\x7fELF");
    h[4] = 2; // ELFCLASS64
    h[5] = 1; // little-endian
    let m = machine.to_le_bytes();
    h[18] = m[0];
    h[19] = m[1];
    h
}

#[cfg(target_os = "linux")]
#[test]
fn elf_architecture_is_verified() {
    let x86 = fake_elf(62);
    let arm = fake_elf(183);
    assert!(looks_like_linux_executable(&x86, "x86_64"));
    assert!(!looks_like_linux_executable(&x86, "aarch64"));
    assert!(looks_like_linux_executable(&arm, "aarch64"));
    assert!(!looks_like_linux_executable(&arm, "x86_64"));
    // A big-endian header is read with the matching endianness.
    assert!(elf_machine(b"\x7fELF").is_none());
}

fn fake_pe(machine: u16) -> Vec<u8> {
    let mut h = vec![0u8; 0x48];
    h[0..2].copy_from_slice(b"MZ");
    h[0x3C..0x40].copy_from_slice(&0x40u32.to_le_bytes()); // e_lfanew → 0x40
    h[0x40..0x44].copy_from_slice(b"PE\0\0");
    h[0x44..0x46].copy_from_slice(&machine.to_le_bytes());
    h
}

#[test]
fn pe_architecture_is_verified() {
    let x64 = fake_pe(0x8664);
    let arm = fake_pe(0xAA64);
    assert!(looks_like_windows_executable(&x64, "x86_64"));
    assert!(!looks_like_windows_executable(&x64, "aarch64"));
    assert!(looks_like_windows_executable(&arm, "aarch64"));
    assert!(!looks_like_windows_executable(&arm, "x86_64"));
    // A bare DOS stub (no PE header) and non-PE bytes are rejected.
    assert!(!looks_like_windows_executable(b"MZ", "x86_64"));
    assert!(pe_machine(b"not-an-exe").is_none());
}

#[test]
fn embedded_minisign_key_parses() {
    // The baked-in public key must be a valid minisign key (empty = signature
    // verification disabled, which is allowed until the key is configured).
    let key = crate::constants::MINISIGN_PUBLIC_KEY;
    if !key.is_empty() {
        assert!(minisign_verify::PublicKey::from_base64(key).is_ok());
    }
}

#[test]
fn sha256_matches_known_vector() {
    // NIST test vector: SHA-256("abc").
    assert_eq!(
        sha256_hex_bytes(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(
        sha256_hex_bytes(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[cfg(all(unix, not(target_os = "macos")))]
#[test]
fn package_selection_is_architecture_aware() {
    assert_eq!(
        linux_package_candidates(true, "x86_64")[0],
        "shelveshub-steamos.tar.gz"
    );
    assert_eq!(
        linux_package_candidates(true, "aarch64")[0],
        "shelveshub-steamos-aarch64.tar.gz"
    );
    assert_eq!(
        linux_package_candidates(false, "aarch64")[0],
        "shelveshub-linux-aarch64.tar.gz"
    );
    assert_eq!(
        linux_package_candidates(false, "x86_64")[0],
        "shelveshub-linux.tar.gz"
    );
    // An architecture we don't ship yields no candidates (self-update refuses).
    assert!(linux_package_candidates(true, "riscv64").is_empty());
}

#[test]
fn finds_backend_archive_asset() {
    let json = r#"{"assets":[
        {"name":"index.iife.js","browser_download_url":"https://x/index.iife.js"},
        {"name":"deck-shelves-backend.tar.gz","browser_download_url":"https://x/backend.tgz"}
    ]}"#;
    assert_eq!(
        find_backend_asset_url(json).as_deref(),
        Some("https://x/backend.tgz")
    );
    // No backend archive → None (data RPC stays disabled, core still works).
    let none = r#"{"assets":[{"name":"index.iife.js","browser_download_url":"https://x/i"}]}"#;
    assert!(find_backend_asset_url(none).is_none());
}

#[test]
fn finds_newest_backend_archive_across_releases() {
    let json = r#"[
        {"assets":[{"name":"index.iife.js","browser_download_url":"https://x/i"}]},
        {"assets":[{"name":"deck-shelves-backend.tgz","browser_download_url":"https://x/b.tgz"}]}
    ]"#;
    assert_eq!(
        find_newest_backend_in_releases(json).as_deref(),
        Some("https://x/b.tgz")
    );
}

#[test]
fn release_url_parts_name_the_repository_and_the_tag() {
    assert_eq!(
        release_url_parts(
            "https://github.com/santojon/Deck-Shelves/releases/download/v3.3.1/index.iife.js"
        ),
        Some(("santojon/Deck-Shelves", "v3.3.1"))
    );
    assert_eq!(
        release_url_parts(
            "https://github.com/santojon/Deck-Shelves/releases/download/v3.3.1/deck-shelves-backend.tar.gz"
        )
        .map(|(_, tag)| tag),
        Some("v3.3.1")
    );
    assert!(
        release_url_parts("https://github.com/santojon/Deck-Shelves/releases/latest").is_none()
    );
    assert!(release_url_parts("https://example.com/releases/download/v1/x").is_none());
    assert!(release_url_parts("https://github.com//releases/download/v1/x").is_none());
    assert!(release_url_parts("https://github.com/a/b/releases/download//x").is_none());
}

#[test]
fn backend_refresh_is_due_until_the_same_release_is_recorded() {
    let dir = std::env::temp_dir().join(format!("shelveshub-backend-tag-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    // A copied or pre-installed backend carries no marker: refreshed once, whatever the tag.
    assert!(backend_refresh_due(&dir, "v3.3.1"));
    record_backend_tag(
        &dir,
        "https://github.com/santojon/Deck-Shelves/releases/download/v3.3.1/deck-shelves-backend.tar.gz",
    );
    assert!(!backend_refresh_due(&dir, "v3.3.1"));
    assert!(backend_refresh_due(&dir, "v3.4.0"));
    // A URL that names no release leaves the marker alone.
    record_backend_tag(&dir, "https://example.com/deck-shelves-backend.tar.gz");
    assert!(!backend_refresh_due(&dir, "v3.3.1"));
    // The release already installed: nothing to fetch (no network is touched).
    assert!(matches!(
        refresh_backend(&dir, "v3.3.1"),
        Ok(BackendRefresh::Unchanged)
    ));
    // Anything that is not a plain release tag is refused before any request.
    for bad in [
        "",
        "..",
        "../v3.4.0",
        "v3.4.0/x",
        "v3.4.0?x=1",
        "v3.4.0#x",
        "v%2e",
    ] {
        assert!(refresh_backend(&dir, bad).is_err(), "{bad:?}");
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn pinned_release_tag_reads_only_the_projects_release_downloads() {
    assert_eq!(
        pinned_release_tag(
            "https://github.com/santojon/Deck-Shelves/releases/download/v3.4.0/index.iife.js"
        ),
        Some("v3.4.0")
    );
    assert_eq!(
        pinned_release_tag(
            "https://github.com/santojon/Deck-Shelves/releases/download/v3.4.0-beta.1/x.zip"
        ),
        Some("v3.4.0-beta.1")
    );
    // Another repository, owner or host names no release of ours.
    for other in [
        "https://github.com/evil/Deck-Shelves/releases/download/v3.4.0/index.iife.js",
        "https://github.com/santojon/Other/releases/download/v3.4.0/index.iife.js",
        "https://example.com/releases/download/v3.4.0/index.iife.js",
        TRUSTED_BUNDLE_PREFIX,
    ] {
        assert_eq!(pinned_release_tag(other), None, "{other}");
    }
    // A tag that would reshape the API URL it goes into.
    for smuggled in ["..", "v1?x=1", "v1#x", "v%2e%2e"] {
        let url = format!("{TRUSTED_BUNDLE_PREFIX}{smuggled}/index.iife.js");
        assert_eq!(pinned_release_tag(&url), None, "{url}");
    }
}

#[test]
fn trusted_backend_url_gate() {
    let good =
        "https://github.com/santojon/Deck-Shelves/releases/download/v3.4.0/deck-shelves-backend.tar.gz";
    assert!(is_trusted_backend_url(good));
    assert!(is_trusted_backend_url(
        "https://github.com/santojon/Deck-Shelves/releases/download/v3.4.0/backend.TGZ"
    ));
    // A release answering with an archive outside the pinned repository is refused.
    let foreign = r#"{"assets":[{"name":"deck-shelves-backend.tar.gz",
        "browser_download_url":"https://evil.example.com/deck-shelves-backend.tar.gz"}]}"#;
    let url = find_backend_asset_url(foreign).unwrap();
    assert!(!is_trusted_backend_url(&url));
    assert!(!is_trusted_backend_url(
        "https://github.com/evil/Deck-Shelves/releases/download/v3.4.0/deck-shelves-backend.tar.gz"
    ));
    // Not an archive, or a query / fragment / traversal smuggled in.
    assert!(!is_trusted_backend_url(
        "https://github.com/santojon/Deck-Shelves/releases/download/v3.4.0/index.iife.js"
    ));
    assert!(!is_trusted_backend_url(&format!("{good}?x=1")));
    assert!(!is_trusted_backend_url(&format!("{good}#x")));
    assert!(!is_trusted_backend_url(
        "https://github.com/santojon/Deck-Shelves/releases/download/../evil/backend.tar.gz"
    ));
}

#[test]
fn replace_dir_swaps_the_tree_in_place_and_keeps_the_old_one_on_failure() {
    let dir = std::env::temp_dir().join(format!("shelveshub-replace-dir-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    let current = dir.join("backend");
    let fresh = sibling_dir(&current, "new");
    assert_eq!(fresh, dir.join("backend.new"));
    fs::create_dir_all(current.join("src").join("backend")).unwrap();
    fs::write(current.join("main.py"), b"old").unwrap();
    fs::create_dir_all(&fresh).unwrap();
    fs::write(fresh.join("main.py"), b"new").unwrap();

    replace_dir(&current, &fresh).unwrap();
    assert_eq!(fs::read(current.join("main.py")).unwrap(), b"new");
    assert!(!current.join("src").exists());
    assert!(!fresh.exists());
    assert!(!sibling_dir(&current, "old").exists());

    // No fresh tree to move in: the installed one is put back untouched.
    assert!(replace_dir(&current, &fresh).is_err());
    assert_eq!(fs::read(current.join("main.py")).unwrap(), b"new");
    assert!(!sibling_dir(&current, "old").exists());

    // Nothing installed yet: the fresh tree simply lands.
    fs::remove_dir_all(&current).unwrap();
    fs::create_dir_all(&fresh).unwrap();
    fs::write(fresh.join("main.py"), b"first").unwrap();
    replace_dir(&current, &fresh).unwrap();
    assert_eq!(fs::read(current.join("main.py")).unwrap(), b"first");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn plugin_channel_combines_the_flag_the_plugin_switch_and_the_hub_switches() {
    let dir = std::env::temp_dir().join(format!("shelveshub-channel-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("settings.json"),
        r#"{"state":{"betaChannelEnabled":false}}"#,
    )
    .unwrap();
    let mut hub = crate::store::HubSettings {
        auto_update: false,
        auto_update_plugin: true,
        plugin_prerelease: false,
        ..Default::default()
    };
    assert!(!plugin_prerelease(false, &dir, &hub));
    // An explicit env/file flag always forces the channel.
    assert!(plugin_prerelease(true, &dir, &hub));
    // The hub's plugin-beta switch counts only under both auto-update switches.
    hub.plugin_prerelease = true;
    assert!(!plugin_prerelease(false, &dir, &hub));
    hub.auto_update = true;
    assert!(plugin_prerelease(false, &dir, &hub));
    hub.auto_update_plugin = false;
    assert!(!plugin_prerelease(false, &dir, &hub));
    // The plugin's own beta switch counts on its own.
    fs::write(
        dir.join("settings.json"),
        r#"{"state":{"betaChannelEnabled":true}}"#,
    )
    .unwrap();
    assert!(plugin_prerelease(false, &dir, &hub));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn maps_release_download_url_to_tags_api() {
    assert_eq!(
        release_tags_api_url(
            "https://github.com/santojon/Deck-Shelves/releases/download/v3.2.2-beta.1/deck-shelves-v3.2.2-beta.1.zip"
        )
        .as_deref(),
        Some("https://api.github.com/repos/santojon/Deck-Shelves/releases/tags/v3.2.2-beta.1")
    );
    // Not a release-download URL → None (no recovery attempted).
    assert!(release_tags_api_url("https://github.com/santojon/Deck-Shelves").is_none());
    assert!(release_tags_api_url("https://example.com/x.zip").is_none());
}

#[test]
fn no_iife_asset_returns_none() {
    let json = r#"{"assets":[{"name":"deck-shelves.zip","browser_download_url":"https://x/zip"}]}"#;
    assert!(find_iife_asset_url(json).is_none());
}

#[test]
fn apply_update_refuses_untrusted_or_nonjs_urls() {
    let dest = std::env::temp_dir().join("shelveshub-apply-update-test.js");
    // Not GitHub-hosted.
    let e = apply_update(&dest, Some("https://evil.example.com/x.iife.js"), false).unwrap_err();
    assert!(e.contains("refused"), "{e}");
    // GitHub but not a JS bundle.
    let e2 = apply_update(
        &dest,
        Some("https://github.com/santojon/Deck-Shelves/releases/download/v1/mal.exe"),
        false,
    )
    .unwrap_err();
    assert!(e2.contains("refused"), "{e2}");
}

#[test]
fn newest_non_draft_iife_wins_including_prerelease() {
    // Releases newest-first: the draft is skipped, then the newest non-draft
    // with an iife asset wins — a pre-release counts under the beta channel.
    let json = r#"[
        {"draft":true,"prerelease":false,"assets":[{"name":"index.iife.js","browser_download_url":"https://x/draft.iife.js"}]},
        {"draft":false,"prerelease":true,"assets":[{"name":"index.iife.js","browser_download_url":"https://x/beta.iife.js"}]},
        {"draft":false,"prerelease":false,"assets":[{"name":"index.iife.js","browser_download_url":"https://x/stable.iife.js"}]}
    ]"#;
    assert_eq!(
        find_newest_iife_in_releases(json).as_deref(),
        Some("https://x/beta.iife.js")
    );
}

#[test]
fn newest_release_tag_matches_the_newest_iife_release() {
    // The tag used by the auto-update check must come from the SAME release
    // download would pick: the draft is skipped, then the newest non-draft
    // with an iife asset. Its tag is what gets recorded/compared.
    let json = r#"[
        {"draft":true,"tag_name":"v9.9.9","assets":[{"name":"index.iife.js","browser_download_url":"https://x/draft.iife.js"}]},
        {"draft":false,"tag_name":"v3.3.0-beta.1","assets":[{"name":"index.iife.js","browser_download_url":"https://x/beta.iife.js"}]},
        {"draft":false,"tag_name":"v3.2.1","assets":[{"name":"index.iife.js","browser_download_url":"https://x/stable.iife.js"}]}
    ]"#;
    let newest = newest_release_in_releases(json).unwrap();
    assert_eq!(release_tag(&newest).as_deref(), Some("v3.3.0-beta.1"));
}

#[test]
fn release_notes_are_trimmed_normalized_and_capped() {
    let short: serde_json::Value =
        serde_json::from_str(r#"{"body":"\r\n## What's new\r\n- a fix\r\n"}"#).unwrap();
    assert_eq!(release_notes(&short), "## What's new\n- a fix");
    let none: serde_json::Value = serde_json::from_str(r#"{"tag_name":"v1"}"#).unwrap();
    assert_eq!(release_notes(&none), "");
    let long = serde_json::json!({ "body": "x".repeat(RELEASE_NOTES_PREVIEW_CHARS + 50) });
    let notes = release_notes(&long);
    assert_eq!(notes.chars().count(), RELEASE_NOTES_PREVIEW_CHARS + 1);
    assert!(notes.ends_with('…'));
}

#[test]
fn bundle_swap_keeps_previous_copy_and_rollback_restores_it() {
    let dir = std::env::temp_dir().join(format!("shelveshub-rollback-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let dest = dir.join("index.js");
    let old = vec![b'A'; REAL_BUNDLE_MIN_BYTES as usize + 1];
    let new = vec![b'B'; REAL_BUNDLE_MIN_BYTES as usize + 1];
    fs::write(&dest, &old).unwrap();
    let tmp = dir.join(".bundle.download.tmp");
    fs::write(&tmp, &new).unwrap();

    swap_bundle_in(&tmp, &dest).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), new);
    assert!(!tmp.exists());
    assert!(bundle_rollback_available(&dest));
    assert_eq!(fs::read(bundle_previous_path(&dest)).unwrap(), old);

    // Going back restores the old copy and keeps the undone one as `.prev`.
    rollback_bundle(&dest).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), old);
    assert_eq!(fs::read(bundle_previous_path(&dest)).unwrap(), new);
    assert!(!dir.join(".bundle.rollback.tmp").exists());

    // A placeholder-sized `.prev` is not a rollback candidate.
    fs::write(bundle_previous_path(&dest), b"tiny").unwrap();
    assert!(!bundle_rollback_available(&dest));
    assert!(rollback_bundle(&dest).is_err());
    assert_eq!(fs::read(&dest).unwrap(), old);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn hub_rollback_restores_the_snapshot_and_keeps_the_undone_set() {
    let dir = std::env::temp_dir().join(format!("shelveshub-hubrollback-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("runtime")).unwrap();
    let exe = dir.join(hub_binary_name());
    // A "previous" set: a real-looking binary of the old version + its runtime.
    let prev = dir.join(HUB_PREVIOUS_DIR);
    fs::create_dir_all(prev.join("runtime")).unwrap();
    let old_bin = fake_exe_body(b'o');
    fs::write(prev.join(hub_binary_name()), &old_bin).unwrap();
    fs::write(prev.join("runtime").join("host.js"), b"old runtime").unwrap();
    fs::write(prev.join("VERSION"), "0.5.0\n").unwrap();
    assert_eq!(snapshot_version(&prev).as_deref(), Some("0.5.0"));
    // The current (newer) set on disk.
    let new_bin = fake_exe_body(b'n');
    fs::write(&exe, &new_bin).unwrap();
    fs::write(dir.join("runtime").join("host.js"), b"new runtime").unwrap();

    assert_eq!(rollback_hub_at(&exe, "0.6.0").unwrap(), "0.5.0");
    assert_eq!(fs::read(&exe).unwrap(), old_bin);
    assert_eq!(
        fs::read(dir.join("runtime").join("host.js")).unwrap(),
        b"old runtime"
    );
    // The set that was left is now the snapshot, so the step can be undone again.
    assert_eq!(snapshot_version(&prev).as_deref(), Some("0.6.0"));
    assert_eq!(fs::read(prev.join(hub_binary_name())).unwrap(), new_bin);
    assert!(!dir.join(HUB_PREVIOUS_STAGING).exists());

    // Without a snapshot there is nothing to go back to.
    fs::remove_dir_all(&prev).unwrap();
    assert!(rollback_hub_at(&exe, "0.5.0").is_err());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn hub_rollback_is_refused_while_an_update_is_staged() {
    // The file at the exe path is then an un-run release: nothing truthful to snapshot.
    let _serial = crate::state::UPDATE_GUARD_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    crate::state::set_hub_update_staged(true);
    let err = rollback_hub().unwrap_err();
    crate::state::set_hub_update_staged(false);
    assert!(err.contains("update is staged"), "{err}");
}

#[test]
fn hub_rollback_clears_an_interrupted_staging_and_snapshots_the_running_set() {
    // A leftover `<exe>.new` was never swapped in, so the exe path still holds the
    // running set: it is snapshotted as usual and the leftover is removed.
    let dir = std::env::temp_dir().join(format!(
        "shelveshub-hubrollback-leftover-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("runtime")).unwrap();
    let exe = dir.join(hub_binary_name());
    let prev = dir.join(HUB_PREVIOUS_DIR);
    fs::create_dir_all(prev.join("runtime")).unwrap();
    let old_bin = fake_exe_body(b'o');
    fs::write(prev.join(hub_binary_name()), &old_bin).unwrap();
    fs::write(prev.join("runtime").join("host.js"), b"old runtime").unwrap();
    fs::write(prev.join("VERSION"), "0.5.0\n").unwrap();
    let running_bin = fake_exe_body(b'r');
    fs::write(&exe, &running_bin).unwrap();
    fs::write(dir.join("runtime").join("host.js"), b"running runtime").unwrap();
    fs::write(staged_binary_path(&exe), b"interrupted staging").unwrap();

    assert_eq!(rollback_hub_at(&exe, "0.6.0").unwrap(), "0.5.0");
    assert_eq!(fs::read(&exe).unwrap(), old_bin);
    assert_eq!(snapshot_version(&prev).as_deref(), Some("0.6.0"));
    assert_eq!(fs::read(prev.join(hub_binary_name())).unwrap(), running_bin);
    assert!(!staged_binary_path(&exe).exists());
    assert!(!dir.join(HUB_PREVIOUS_STAGING).exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn copy_into_replaces_the_target_through_a_sibling_temp() {
    let dir = std::env::temp_dir().join(format!("shelveshub-copyinto-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let src = dir.join("src.js");
    let dest = dir.join("sub").join("live.js");
    fs::write(&src, b"NEW").unwrap();
    fs::create_dir_all(dest.parent().unwrap()).unwrap();
    fs::write(&dest, b"OLD").unwrap();

    copy_into(&src, &dest).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), b"NEW");
    assert!(!dir.join("sub").join(".live.js.tmp").exists());
    // A missing source fails cleanly and leaves the target untouched.
    assert!(copy_into(&dir.join("absent.js"), &dest).is_err());
    assert_eq!(fs::read(&dest).unwrap(), b"NEW");
    let _ = fs::remove_dir_all(&dir);
}

/// A fake binary that passes the executable checks: the right magic, padded
/// past the size floor.
fn fake_exe_body(fill: u8) -> Vec<u8> {
    let mut bin = fake_exe_head();
    bin.resize(REAL_BINARY_MIN_BYTES as usize + 8, fill);
    bin
}

#[test]
fn binary_floor_is_separate_from_the_bundle_floor() {
    // A bundle-sized "binary" is not a usable snapshot, even with the right magic.
    let dir = std::env::temp_dir().join(format!("shelveshub-binfloor-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let mut small = fake_exe_head();
    small.resize(REAL_BUNDLE_MIN_BYTES as usize + 8, b'x');
    fs::write(dir.join(hub_binary_name()), &small).unwrap();
    fs::write(dir.join("VERSION"), "0.5.0").unwrap();
    assert!(snapshot_version(&dir).is_none());
    fs::write(dir.join(hub_binary_name()), fake_exe_body(b'x')).unwrap();
    assert_eq!(snapshot_version(&dir).as_deref(), Some("0.5.0"));
    let _ = fs::remove_dir_all(&dir);
}

/// The executable magic for the compile target (what `looks_like_executable` accepts).
fn fake_exe_head() -> Vec<u8> {
    #[cfg(target_os = "windows")]
    {
        fake_pe(pe_machine_for_arch(std::env::consts::ARCH).unwrap())
    }
    #[cfg(target_os = "linux")]
    {
        fake_elf(elf_machine_for_arch(std::env::consts::ARCH).unwrap())
    }
    #[cfg(target_os = "macos")]
    {
        vec![0xcf, 0xfa, 0xed, 0xfe]
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        vec![0x7F, b'E', b'L', b'F', 0, 0]
    }
}

#[test]
fn release_tag_reads_tag_name_and_rejects_empty() {
    let with_tag: serde_json::Value = serde_json::from_str(r#"{"tag_name":"v3.2.1"}"#).unwrap();
    assert_eq!(release_tag(&with_tag).as_deref(), Some("v3.2.1"));
    let empty: serde_json::Value = serde_json::from_str(r#"{"tag_name":""}"#).unwrap();
    assert!(release_tag(&empty).is_none());
    let missing: serde_json::Value = serde_json::from_str(r#"{}"#).unwrap();
    assert!(release_tag(&missing).is_none());
}

#[test]
fn signatures_required_when_key_is_baked() {
    // The public key is embedded (see embedded_minisign_key_parses), so updates
    // fail closed by default; only the explicit dev escape hatch relaxes it.
    assert!(!MINISIGN_PUBLIC_KEY.is_empty());
    assert!(std::env::var("SHELVES_ALLOW_UNSIGNED_UPDATE").is_err());
    assert!(signatures_required());
}

#[test]
fn release_without_sums_is_refused_when_signatures_required() {
    // No SHA256SUMS asset → the fail-closed branch returns before any download,
    // so a dummy archive path is fine.
    let release: serde_json::Value = serde_json::from_str(r#"{"assets":[]}"#).unwrap();
    let err = verify_release_archive(
        &release,
        "shelveshub-linux.tar.gz",
        std::path::Path::new("/x"),
    )
    .unwrap_err();
    assert!(err.contains("SHA256SUMS"), "unexpected error: {err}");
    assert!(err.contains("refusing update"), "unexpected error: {err}");
}

#[test]
fn placeholder_is_not_a_real_bundle() {
    let dir = std::env::temp_dir().join("shelveshub-populate-test");
    let _ = fs::create_dir_all(&dir);
    let p = dir.join("placeholder.js");
    fs::write(&p, b"// placeholder\n").unwrap();
    assert!(!is_real_bundle(&p));
    fs::write(&p, vec![b'x'; 8192]).unwrap();
    assert!(is_real_bundle(&p));
    let _ = fs::remove_file(&p);
}

#[test]
fn sha256_for_name_parses_both_shapes_and_skips_noise() {
    let h = "a".repeat(64);
    let g = "b".repeat(64);
    // two-space (text) form and `*` (binary) form both parse; a 404 "Not Found"
    // body or a short/garbage hash yields None (→ verification is skipped).
    let sums = format!(
        "{h}  index.iife.js\n{g} *deck-shelves-backend.tar.gz\nNot Found\ndead  short.js\n"
    );
    assert_eq!(
        sha256_for_name(&sums, "index.iife.js").as_deref(),
        Some(h.as_str())
    );
    assert_eq!(
        sha256_for_name(&sums, "deck-shelves-backend.tar.gz").as_deref(),
        Some(g.as_str())
    );
    assert_eq!(sha256_for_name(&sums, "short.js"), None); // hash not 64 hex
    assert_eq!(sha256_for_name(&sums, "missing.js"), None); // not listed
    assert_eq!(sha256_for_name("404: Not Found", "index.iife.js"), None);
}

#[test]
fn plugin_update_prefs_read_the_wrapped_settings_file() {
    let dir = std::env::temp_dir().join(format!("shelves-prefs-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("settings.json"),
        r#"{"state":{"betaChannelEnabled":true,"updateNotifyEnabled":false},"rev":3,"updatedAt":1}"#,
    )
    .unwrap();
    let p = plugin_update_prefs(&dir);
    assert!(p.beta);
    assert!(!p.auto_update);
    std::fs::write(dir.join("settings.json"), r#"{"betaChannelEnabled":true}"#).unwrap();
    assert!(plugin_update_prefs(&dir).beta);
    let _ = std::fs::remove_dir_all(&dir);
}
