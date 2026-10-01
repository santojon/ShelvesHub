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
