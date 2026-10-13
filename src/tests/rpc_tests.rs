// Unit tests for the `rpc` module, extracted from rpc.rs and attached
// via `#[cfg(test)] #[path = "tests/rpc_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

use super::*;

#[test]
fn constant_time_eq_matches_only_equal() {
    assert!(constant_time_eq(b"abc", b"abc"));
    assert!(constant_time_eq(b"", b""));
    assert!(!constant_time_eq(b"abc", b"abd"));
    assert!(!constant_time_eq(b"abc", b"ab"));
    assert!(!constant_time_eq(b"", b"x"));
}

#[test]
fn recover_cmd_is_not_rpc_editable() {
    // recover_cmd runs through a shell — it must never be settable over RPC.
    assert!(!EDITABLE_CONFIG_KEYS.contains(&"recover_cmd"));
}

#[test]
fn backend_proxy_allowlist_bounds_the_surface() {
    // Real API methods pass; arbitrary Python attributes do not.
    assert!(BACKEND_METHODS.contains(&"get_settings"));
    assert!(BACKEND_METHODS.contains(&"write_json_file"));
    assert!(!BACKEND_METHODS.contains(&"os.system"));
    assert!(!BACKEND_METHODS.contains(&"__import__"));
    assert!(!BACKEND_METHODS.contains(&"eval"));
}

#[test]
fn dispatches_ping() {
    assert_eq!(
        dispatch(r#"{"method":"ping"}"#),
        r#"{"ok":true,"result":"pong"}"#
    );
}

#[test]
fn dispatches_is_injected() {
    state::set_injected(false);
    assert_eq!(
        dispatch(r#"{"method":"isInjected"}"#),
        r#"{"ok":true,"result":false}"#
    );
}

#[test]
fn dispatches_host_api_version() {
    assert_eq!(
        dispatch(r#"{"method":"getHostApiVersion"}"#),
        format!(r#"{{"ok":true,"result":"{}"}}"#, crate::HOST_API_VERSION)
    );
}

#[test]
fn dispatches_bundle_ready() {
    state::set_bundle_ready(false);
    assert_eq!(
        dispatch(r#"{"method":"bundleReady"}"#),
        r#"{"ok":true,"result":true}"#
    );
    assert!(state::is_bundle_ready());
}

#[test]
fn rejects_unknown_method() {
    assert_eq!(
        dispatch(r#"{"method":"nope"}"#),
        r#"{"ok":false,"error":"unknown method: nope"}"#
    );
}

#[test]
fn rollback_hub_without_a_snapshot_is_refused() {
    // The test binary has no `previous/` snapshot beside it — nothing is staged.
    assert_eq!(
        dispatch(r#"{"method":"rollbackHub"}"#),
        r#"{"ok":false,"error":"no previous ShelvesHub to go back to"}"#
    );
    assert!(!state::hub_rollback_staged());
}

#[test]
fn rejects_garbage() {
    assert_eq!(
        dispatch("not json"),
        r#"{"ok":false,"error":"missing or invalid method"}"#
    );
}

#[test]
fn config_editor_refuses_keys_outside_the_safe_subset() {
    // recover_cmd and unknown keys never reach the config file, whatever the value.
    for key in ["recover_cmd", "cef_port", "bundle_path", "nope"] {
        let body =
            format!(r#"{{"method":"setRuntimeConfig","args":{{"key":"{key}","value":true}}}}"#);
        let out = dispatch(&body);
        assert!(out.contains("refused config key"), "{key}: {out}");
    }
}

#[test]
fn config_editor_refuses_wrong_value_types() {
    let out =
        dispatch(r#"{"method":"setRuntimeConfig","args":{"key":"native_qam","value":"yes"}}"#);
    assert!(out.contains("invalid value type"), "{out}");
    let out =
        dispatch(r#"{"method":"setRuntimeConfig","args":{"key":"interval_secs","value":-1}}"#);
    assert!(out.contains("invalid value type"), "{out}");
}

#[test]
fn update_pref_and_config_sync_need_a_known_key_and_a_store() {
    // Without a configured store the handlers refuse rather than write anywhere.
    let out =
        dispatch(r#"{"method":"setUpdatePref","args":{"key":"quiet_updates","value":false}}"#);
    assert!(
        out.contains("hub config path not configured") || out.contains("unknown update pref"),
        "{out}"
    );
    let out = dispatch(r#"{"method":"setConfigSync","args":true}"#);
    assert!(
        out.contains("hub config path not configured") || out.contains("config_sync"),
        "{out}"
    );
}
