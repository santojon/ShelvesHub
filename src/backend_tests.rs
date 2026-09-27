// Unit tests for the `backend` module, extracted from backend.rs and attached
// via `#[cfg(test)] #[path = "backend_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

use super::*;

#[test]
fn accepts_plain_method_names() {
    assert!(valid_method_name("get_settings"));
    assert!(valid_method_name("listBackups2"));
}

#[test]
fn rejects_private_and_malformed_names() {
    assert!(!valid_method_name(""));
    assert!(!valid_method_name("_main"));
    assert!(!valid_method_name("_unload"));
    assert!(!valid_method_name("9lives"));
    assert!(!valid_method_name("a.b"));
    assert!(!valid_method_name("a b"));
    assert!(!valid_method_name(&"x".repeat(65)));
}

#[test]
fn call_without_configuration_fails_cleanly() {
    // SETTINGS is never initialised in unit tests, so any call must
    // report the backend as unavailable rather than panic.
    let result = call("get_settings", &Value::Null);
    assert_eq!(result.unwrap_err(), "backend is not running");
}
