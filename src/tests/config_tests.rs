// Unit tests for the `config` module, extracted from config.rs and attached
// via `#[cfg(test)] #[path = "tests/config_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

use super::*;

#[test]
fn config_file_overrides_default() {
    // A key not present in the environment, so the file value is used.
    const UNSET: &str = "SHELVES_UNSET_TEST_KEY_XYZ";
    let file = serde_json::json!({
        "rpc_host": "0.0.0.0",
        "rpc_port": 60124,
        "owner_settle_secs": 25,
        "native_qam": true
    });
    assert_eq!(cfg_string(&file, UNSET, "rpc_host", "127.0.0.1"), "0.0.0.0");
    assert_eq!(cfg_u16(&file, UNSET, "rpc_port", 60123), 60124);
    assert_eq!(cfg_u64(&file, UNSET, "owner_settle_secs", 0), 25);
    assert!(cfg_bool(&file, UNSET, "native_qam"));
    // Missing key → built-in default.
    assert_eq!(cfg_u16(&file, UNSET, "absent", 8080), 8080);
    assert!(!cfg_bool(&file, UNSET, "absent"));
    // Empty / null file → default.
    assert_eq!(cfg_u16(&Value::Null, UNSET, "rpc_port", 60123), 60123);
}

#[test]
fn recover_cmd_resolution() {
    // "off" (any case, trimmed) disables auto-recovery → pause only.
    assert_eq!(resolve_recover_cmd(Some("off".to_string())), None);
    assert_eq!(resolve_recover_cmd(Some("OFF".to_string())), None);
    assert_eq!(resolve_recover_cmd(Some("  Off ".to_string())), None);
    // A custom command passes through (trimmed).
    assert_eq!(
        resolve_recover_cmd(Some("  my-recover ".to_string())),
        Some("my-recover".to_string())
    );
    // Empty or absent → the per-platform official default (non-None on all targets).
    assert_eq!(
        resolve_recover_cmd(Some(String::new())),
        default_recover_cmd()
    );
    assert_eq!(resolve_recover_cmd(None), default_recover_cmd());
    // macOS/Windows (always sole hosts) always have a default; on Linux the default is
    // runtime-detected (the steam-launcher unit may be absent → None, pause only).
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    assert!(resolve_recover_cmd(None).is_some());
}

// ARM-8: the Linux recovery default is runtime-detected — present ⇒ restart the
// session service, absent ⇒ None (pause only). Deterministic on any Linux (CI has
// no steam-launcher ⇒ None; a Deck has it ⇒ Some).
#[cfg(target_os = "linux")]
#[test]
fn linux_recovery_matches_steam_launcher_presence() {
    assert_eq!(default_recover_cmd().is_some(), steam_launcher_present());
}
