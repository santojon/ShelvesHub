// Unit tests for the `rpc` module, extracted from rpc.rs and attached
// via `#[cfg(test)] #[path = "rpc_tests.rs"] mod tests;` — `super::*`
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
fn rejects_garbage() {
    assert_eq!(
        dispatch("not json"),
        r#"{"ok":false,"error":"missing or invalid method"}"#
    );
}
