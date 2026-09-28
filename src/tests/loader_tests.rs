// Unit tests for the `mod` module, extracted from mod.rs and attached
// via `#[cfg(test)] #[path = "../tests/loader_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

use super::*;

#[test]
fn injects_when_unclaimed_or_own() {
    assert!(may_inject("", false));
    assert!(may_inject(OWNER_KIND, false));
}

#[test]
fn port_candidates_probe_configured_first_then_alternates_deduped() {
    // Configured is always tried first; the known alternates follow, and the
    // configured port is never listed twice.
    assert_eq!(port_candidates(8080), vec![8080, 8081]);
    assert_eq!(port_candidates(8081), vec![8081, 8080]);
    assert_eq!(port_candidates(9999), vec![9999, 8080, 8081]);
}

#[test]
fn version_is_newer_uses_semver_precedence() {
    // Core comparison.
    assert!(version_is_newer("v0.2.0", "0.1.0"));
    assert!(version_is_newer("0.1.1", "0.1.0"));
    assert!(!version_is_newer("v0.1.0", "0.1.0")); // equal → not newer
    assert!(!version_is_newer("v0.0.1", "0.1.0")); // older → not newer
                                                   // Pre-release precedence: a stable outranks its own pre-release.
    assert!(version_is_newer("3.3.0", "3.3.0-beta.2")); // stable > beta of same core
    assert!(!version_is_newer("3.3.0-beta.2", "3.3.0")); // beta of same core is NOT newer
    assert!(version_is_newer("3.3.0-beta.2", "3.3.0-beta.1")); // beta.2 > beta.1
                                                               // A higher core wins regardless of suffix (channel gates whether it's seen).
    assert!(version_is_newer("3.3.0-beta.2", "3.0.0"));
    // Unparseable never prompts.
    assert!(!version_is_newer("not-a-version", "0.1.0"));
    assert!(!version_is_newer("v0.2.0", "garbage"));
}

#[test]
fn stands_down_for_foreign_owner() {
    assert!(!may_inject("other-host", false));
}

#[test]
fn force_overrides_foreign_owner() {
    assert!(may_inject("other-host", true));
}

#[test]
fn settle_disabled_by_default() {
    // `owner_settle_secs == 0` (the default) never settles — a sole host boots
    // immediately.
    assert!(!keep_settling(0, 0));
    assert!(!keep_settling(0, 100));
}

#[test]
fn settle_waits_until_window_elapses() {
    // Enabled: settle while unclaimed, up to the window; then host as sole host.
    assert!(keep_settling(25, 0));
    assert!(keep_settling(25, 24));
    assert!(!keep_settling(25, 25));
    assert!(!keep_settling(25, 30));
}
