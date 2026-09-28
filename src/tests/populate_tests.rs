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

#[test]
fn hub_update_finds_platform_package_in_priority_order() {
    let release: serde_json::Value = serde_json::from_str(
        r#"{"assets":[
            {"name":"shelveshub-linux.tar.gz","browser_download_url":"https://x/linux"},
            {"name":"shelveshub-steamos.tar.gz","browser_download_url":"https://x/steamos"},
            {"name":"shelveshub-macos.tar.gz","browser_download_url":"https://x/mac"}
        ]}"#,
    )
    .unwrap();
    // First name in the list wins; a missing preferred name falls back.
    assert_eq!(
        find_asset_url_by_names(
            &release,
            &["shelveshub-steamos.tar.gz", "shelveshub-linux.tar.gz"]
        )
        .as_deref(),
        Some("https://x/steamos")
    );
    assert_eq!(
        find_asset_url_by_names(
            &release,
            &["shelveshub-windows.zip", "shelveshub-macos.tar.gz"]
        )
        .as_deref(),
        Some("https://x/mac")
    );
    assert!(find_asset_url_by_names(&release, &["shelveshub-windows.zip"]).is_none());
    // The running OS always has at least one candidate name.
    assert!(!hub_package_candidates().is_empty());
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
    assert_eq!(
        newest_release_tag_in_releases(json).as_deref(),
        Some("v3.3.0-beta.1")
    );
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
