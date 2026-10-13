// Unit tests for the `state` module, extracted from state.rs and attached
// via `#[cfg(test)] #[path = "tests/state_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

use super::*;

#[test]
fn rpc_token_is_nonempty_and_stable() {
    let a = rpc_token();
    assert_eq!(a.len(), 64, "256-bit token, hex-encoded");
    assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(a, rpc_token(), "same token for the process lifetime");
}

#[test]
fn token_file_is_private_from_creation() {
    let dir = std::env::temp_dir().join(format!("shelveshub-token-{}", std::process::id()));
    let path = dir.join("nested").join(".rpc-token");
    persist_rpc_token(&path);
    assert_eq!(
        std::fs::read_to_string(&path).expect("token file"),
        rpc_token()
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&path)
            .expect("metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600, "owner-only from the first write");
    }
    // A second boot's write replaces the file rather than appending to it.
    persist_rpc_token(&path);
    assert_eq!(
        std::fs::read_to_string(&path).expect("token file"),
        rpc_token()
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn update_check_single_flight_guard() {
    let _serial = UPDATE_GUARD_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    assert!(try_begin_update_check(), "first caller acquires the guard");
    assert!(
        !try_begin_update_check(),
        "a second caller is refused while one is in flight"
    );
    end_update_check();
    assert!(
        try_begin_update_check(),
        "the guard is re-acquirable after release"
    );
    end_update_check();
}

#[test]
fn config_edits_are_remembered_by_key_with_the_latest_value() {
    record_config_edit("interval_secs", serde_json::json!(45));
    record_config_edit("native_qam", serde_json::json!(false));
    record_config_edit("interval_secs", serde_json::json!(60));
    let edits = pending_config_edits();
    assert_eq!(edits.get("interval_secs"), Some(&serde_json::json!(60)));
    assert_eq!(edits.get("native_qam"), Some(&serde_json::json!(false)));
}

#[test]
fn host_notices_queue_drains_in_order_and_requeues_at_the_front() {
    drain_host_notices();
    push_host_notice("notice_a", serde_json::json!({ "version": "1" }));
    push_host_notice("notice_b", serde_json::json!({}));
    let taken = drain_host_notices();
    assert_eq!(taken.len(), 2);
    assert_eq!(taken[0].0, "notice_a");
    assert_eq!(taken[0].1["version"], "1");
    assert!(drain_host_notices().is_empty());
    // Notices the renderer could not take go back ahead of anything newer.
    push_host_notice("notice_c", serde_json::json!({}));
    requeue_host_notices(taken);
    let again = drain_host_notices();
    assert_eq!(
        again.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(),
        ["notice_a", "notice_b", "notice_c"]
    );
}

#[test]
fn update_check_stamp_reports_recent_elapsed() {
    // Before stamping, no check has run this session (0 sentinel → None). Once we
    // stamp, the elapsed reads back as a small, non-None duration.
    mark_update_checked_now();
    let since = millis_since_update_check().expect("stamped → Some");
    assert!(since < 60_000, "just-stamped check reads as recent");
}
