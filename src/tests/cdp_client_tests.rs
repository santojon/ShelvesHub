// Unit tests for the `client` module, extracted from client.rs and attached
// via `#[cfg(test)] #[path = "../tests/cdp_client_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

use super::*;

#[test]
fn parses_ws_authority() {
    assert_eq!(
        parse_ws_authority("ws://127.0.0.1:8080/devtools/page/AB").unwrap(),
        ("127.0.0.1".to_string(), 8080)
    );
}

#[test]
fn rejects_non_ws_url() {
    assert!(parse_ws_authority("http://x").is_err());
}
