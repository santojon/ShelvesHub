// Unit tests for the `rpc` module, extracted from rpc.rs and attached
// via `#[cfg(test)] #[path = "tests/rpc_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

use super::*;

/// Dispatch a raw request body, the way `handle_connection` does.
fn call(body: &str) -> String {
    dispatch(serde_json::from_str::<Value>(body).ok())
}

/// Tests that take or observe the process-wide update guard run one at a time.
fn serial_update_guard() -> std::sync::MutexGuard<'static, ()> {
    state::UPDATE_GUARD_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

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
fn coop_bundle_is_rpc_editable() {
    assert!(EDITABLE_CONFIG_KEYS.contains(&"coop_bundle"));
}

#[test]
fn backend_proxy_allowlist_bounds_the_surface() {
    // Real API methods pass; arbitrary Python attributes do not.
    assert!(BACKEND_METHODS.contains(&"get_settings"));
    assert!(BACKEND_METHODS.contains(&"write_json_file"));
    // Every public plugin backend method must be reachable under this host.
    for m in [
        "create_pre_import_backup",
        "get_device_identity",
        "get_shortcut_tags",
        "was_settings_recovered",
    ] {
        assert!(BACKEND_METHODS.contains(&m), "{m} missing");
    }
    assert!(!BACKEND_METHODS.contains(&"os.system"));
    assert!(!BACKEND_METHODS.contains(&"__import__"));
    assert!(!BACKEND_METHODS.contains(&"eval"));
}

#[test]
fn quiet_methods_are_the_read_only_polls() {
    // The hub view's and the tray's refresh paths never reach the log ring.
    for m in ["getLogs", "getDiagnostics", "getConfig", "ping", "pushLogs"] {
        assert!(QUIET_METHODS.contains(&m), "{m} should be quiet");
    }
    // Anything that changes state is still logged.
    for m in [
        "setRuntimeConfig",
        "applyUpdate",
        "restartService",
        "clearLogs",
    ] {
        assert!(!QUIET_METHODS.contains(&m), "{m} should be logged");
    }
}

#[test]
fn dispatches_ping() {
    assert_eq!(
        call(r#"{"method":"ping"}"#),
        r#"{"ok":true,"result":"pong"}"#
    );
}

#[test]
fn dispatches_is_injected() {
    state::set_injected(false);
    assert_eq!(
        call(r#"{"method":"isInjected"}"#),
        r#"{"ok":true,"result":false}"#
    );
}

#[test]
fn dispatches_host_api_version() {
    assert_eq!(
        call(r#"{"method":"getHostApiVersion"}"#),
        format!(r#"{{"ok":true,"result":"{}"}}"#, crate::HOST_API_VERSION)
    );
}

#[test]
fn rejects_unknown_method() {
    assert_eq!(
        call(r#"{"method":"nope"}"#),
        r#"{"ok":false,"error":"unknown method: nope"}"#
    );
    // The bundle-side init confirmation was never sent by any caller; gone.
    assert_eq!(
        call(r#"{"method":"bundleReady"}"#),
        r#"{"ok":false,"error":"unknown method: bundleReady"}"#
    );
}

#[test]
fn diagnostics_report_hosting_without_a_bundle_ready_latch() {
    let out = call(r#"{"method":"getDiagnostics"}"#);
    let parsed: Value = serde_json::from_str(&out).expect("valid JSON");
    assert_eq!(parsed["result"]["hostKind"], "shelveshub");
    assert!(parsed["result"]["hosting"].is_boolean());
    assert!(parsed["result"].get("bundleReady").is_none());
}

#[test]
fn error_envelope_is_valid_json_for_any_message() {
    // Control characters, quotes and backslashes (a relayed Python traceback) must
    // round-trip, not break the envelope.
    let message = "line one\nline two\t\"quoted\" back\\slash \u{1}\r";
    let out = err(message);
    let parsed: Value = serde_json::from_str(&out).expect("valid JSON");
    assert_eq!(parsed["ok"], Value::Bool(false));
    assert_eq!(parsed["error"], Value::String(message.to_string()));
}

#[test]
fn rollback_hub_is_refused_while_staged_or_without_a_snapshot() {
    let _serial = serial_update_guard();
    // A binary staged over the running one: rolling back now would snapshot it.
    state::set_hub_update_staged(true);
    state::set_hub_rollback_staged(false);
    let out = call(r#"{"method":"rollbackHub"}"#);
    assert!(out.contains("update is staged"), "{out}");
    state::set_hub_rollback_staged(true);
    let out = call(r#"{"method":"rollbackHub"}"#);
    assert!(out.contains("rollback is already staged"), "{out}");
    state::set_hub_update_staged(false);
    state::set_hub_rollback_staged(false);
    // The test binary has no `previous/` snapshot beside it — nothing is staged.
    assert_eq!(
        call(r#"{"method":"rollbackHub"}"#),
        r#"{"ok":false,"error":"no previous ShelvesHub to go back to"}"#
    );
    assert!(!state::hub_rollback_staged());
}

#[test]
fn manual_update_paths_answer_busy_while_a_check_runs() {
    let _serial = serial_update_guard();
    assert!(state::try_begin_update_check());
    for body in [
        r#"{"method":"rollbackHub"}"#,
        r#"{"method":"rollbackBundle"}"#,
        r#"{"method":"applyUpdate"}"#,
        r#"{"method":"populateBundle"}"#,
        r#"{"method":"selfUpdate"}"#,
    ] {
        // The `busy: ` prefix is the contract's retry-later signal for applyUpdate.
        let out = call(body);
        assert!(out.contains(r#""error":"busy: "#), "{body}: {out}");
    }
    state::end_update_check();
    // Released: the handler runs again (and refuses for its own reason).
    let out = call(r#"{"method":"rollbackBundle"}"#);
    assert!(out.contains("bundle path not configured"), "{out}");
}

#[test]
fn self_update_is_skipped_when_current_or_already_staged() {
    // Not newer (a reinstall or a downgrade): never staged.
    assert_eq!(
        self_update_skip_reason("v0.5.0", "0.5.0", false, None),
        Some("current")
    );
    assert_eq!(
        self_update_skip_reason("v0.4.9", "0.5.0", true, Some("v0.4.9")),
        Some("current")
    );
    // The same newer release already waits for the restart: not downloaded again.
    assert_eq!(
        self_update_skip_reason("v0.6.0", "0.5.0", true, Some("v0.6.0")),
        Some("staged")
    );
    // Newer and not staged (or a different release staged): go ahead.
    assert_eq!(
        self_update_skip_reason("v0.6.0", "0.5.0", false, None),
        None
    );
    assert_eq!(
        self_update_skip_reason("v0.6.1", "0.5.0", true, Some("v0.6.0")),
        None
    );
    assert_eq!(
        self_update_skip_reason("v0.6.0", "0.5.0", false, Some("v0.6.0")),
        None
    );
}

#[test]
fn self_update_keeps_notes_only_with_the_release_they_describe() {
    let looked_up = || Some(("v0.6.0".to_string(), "What changed".to_string()));
    assert_eq!(
        staged_release_notes(looked_up(), "v0.6.0").as_deref(),
        Some("What changed")
    );
    // A newer release published between the lookup and the download, or a missed
    // lookup: nothing is known about the staged release, so no notes.
    assert_eq!(staged_release_notes(looked_up(), "v0.6.1"), None);
    assert_eq!(staged_release_notes(None, "v0.6.0"), None);
}

#[test]
fn rejects_garbage() {
    assert_eq!(
        call("not json"),
        r#"{"ok":false,"error":"missing or invalid method"}"#
    );
}

#[test]
fn config_editor_refuses_keys_outside_the_safe_subset() {
    // recover_cmd and unknown keys never reach the config file, whatever the value.
    for key in ["recover_cmd", "cef_port", "bundle_path", "nope"] {
        let body =
            format!(r#"{{"method":"setRuntimeConfig","args":{{"key":"{key}","value":true}}}}"#);
        let out = call(&body);
        assert!(out.contains("refused config key"), "{key}: {out}");
    }
}

#[test]
fn config_editor_refuses_wrong_value_types() {
    let out = call(r#"{"method":"setRuntimeConfig","args":{"key":"native_qam","value":"yes"}}"#);
    assert!(out.contains("invalid value type"), "{out}");
    let out = call(r#"{"method":"setRuntimeConfig","args":{"key":"interval_secs","value":-1}}"#);
    assert!(out.contains("invalid value type"), "{out}");
}

#[test]
fn config_editor_refuses_out_of_range_seconds() {
    for (key, value) in [
        ("interval_secs", 0),
        ("interval_secs", 3601),
        ("owner_settle_secs", 301),
    ] {
        let body =
            format!(r#"{{"method":"setRuntimeConfig","args":{{"key":"{key}","value":{value}}}}}"#);
        let out = call(&body);
        assert!(out.contains("out of range"), "{key}={value}: {out}");
    }
    // In range passes the check; without a config file path nothing is written.
    for (key, value) in [
        ("interval_secs", 1),
        ("interval_secs", 3600),
        ("owner_settle_secs", 0),
    ] {
        let body =
            format!(r#"{{"method":"setRuntimeConfig","args":{{"key":"{key}","value":{value}}}}}"#);
        let out = call(&body);
        assert!(
            out.contains("config file path not known"),
            "{key}={value}: {out}"
        );
    }
}

#[test]
fn update_pref_and_config_sync_need_a_known_key_and_a_store() {
    // Without a configured store the handlers refuse rather than write anywhere.
    let out = call(r#"{"method":"setUpdatePref","args":{"key":"quiet_updates","value":false}}"#);
    assert!(
        out.contains("hub config path not configured") || out.contains("unknown update pref"),
        "{out}"
    );
    let out = call(r#"{"method":"setConfigSync","args":true}"#);
    assert!(
        out.contains("hub config path not configured") || out.contains("config_sync"),
        "{out}"
    );
}

#[test]
fn bind_refuses_a_port_another_listener_holds() {
    // Never bind successfully here: that would publish this process's token over
    // the real token file. The refusal comes before the token is written.
    let held = TcpListener::bind("127.0.0.1:0").expect("loopback listener");
    let addr = held.local_addr().expect("bound address").to_string();
    let token_file = || crate::config::rpc_token_path().and_then(|p| std::fs::read(p).ok());
    let before = token_file();
    let refused = bind(&addr).expect_err("a held port is refused");
    assert_eq!(refused.kind(), std::io::ErrorKind::AddrInUse, "{refused}");
    assert!(token_file() == before, "the token file was rewritten");
}

/// Feed one raw request over a loopback socket pair and parse it as the server does.
fn parse_over_loopback(raw: &[u8]) -> std::io::Result<HttpRequest> {
    let listener = TcpListener::bind("127.0.0.1:0").expect("loopback listener");
    let addr = listener.local_addr().expect("bound address");
    let raw = raw.to_vec();
    let writer = std::thread::spawn(move || {
        let mut client = TcpStream::connect(addr).expect("connect");
        client.write_all(&raw).expect("send request");
        client
    });
    let (server, _) = listener.accept().expect("accept");
    let _ = server.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    let parsed = read_request(&server);
    drop(writer.join().expect("client thread"));
    parsed
}

#[test]
fn request_parser_keeps_the_fields_it_needs_and_caps_the_headers() {
    let req = parse_over_loopback(
        b"POST / HTTP/1.1\r\nContent-Type: application/json\r\nOrigin: https://steamloopback.host\r\n\
          Authorization: Bearer abc\r\nContent-Length: 17\r\n\r\n{\"method\":\"ping\"}",
    )
    .expect("well-formed request");
    assert_eq!(req.method, "POST");
    assert_eq!(req.body, r#"{"method":"ping"}"#);
    assert_eq!(req.origin.as_deref(), Some("https://steamloopback.host"));
    assert_eq!(req.authorization.as_deref(), Some("Bearer abc"));
    assert_eq!(req.content_type.as_deref(), Some("application/json"));
    assert!(!req.too_large);

    let long = format!("POST / HTTP/1.1\r\nX-Pad: {}\r\n\r\n", "a".repeat(9000));
    let out = parse_over_loopback(long.as_bytes());
    assert!(out.is_err(), "an endless header line is refused");

    let many = format!("POST / HTTP/1.1\r\n{}\r\n", "X-A: b\r\n".repeat(80));
    let out = parse_over_loopback(many.as_bytes());
    assert!(out.is_err(), "too many headers is refused");
}

#[test]
fn connection_slots_are_bounded_and_released() {
    let before = ACTIVE_CONNECTIONS.load(AtomicOrdering::Acquire);
    let held: Vec<ConnectionSlot> = (before..MAX_CONNECTIONS)
        .map(|_| ConnectionSlot::acquire().expect("slot below the cap"))
        .collect();
    assert!(
        ConnectionSlot::acquire().is_none(),
        "the cap refuses one more"
    );
    drop(held);
    assert_eq!(ACTIVE_CONNECTIONS.load(AtomicOrdering::Acquire), before);
}
