// Unit tests for the `config` module, extracted from config.rs and attached
// via `#[cfg(test)] #[path = "config_tests.rs"] mod tests;` — `super::*`
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
