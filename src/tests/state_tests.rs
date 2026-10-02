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
fn update_check_single_flight_guard() {
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
fn update_check_stamp_reports_recent_elapsed() {
    // Before stamping, no check has run this session (0 sentinel → None). Once we
    // stamp, the elapsed reads back as a small, non-None duration.
    mark_update_checked_now();
    let since = millis_since_update_check().expect("stamped → Some");
    assert!(since < 60_000, "just-stamped check reads as recent");
}
