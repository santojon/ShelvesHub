// Unit tests for the `semver` module, attached via
// `#[cfg(test)] #[path = "tests/semver_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

use super::*;

#[test]
fn version_is_newer_orders_by_semver_precedence() {
    assert!(version_is_newer("v0.7.0", "0.6.0"));
    assert!(version_is_newer("v0.6.1", "0.6.0"));
    assert!(version_is_newer("v1.0.0", "0.99.99"));
    assert!(!version_is_newer("v0.6.0", "0.6.0"));
    assert!(!version_is_newer("v0.5.9", "0.6.0"));
    // A stable release outranks its own pre-release, never the other way round.
    assert!(version_is_newer("v0.7.0", "0.7.0-beta.1"));
    assert!(!version_is_newer("v0.7.0-beta.1", "0.7.0"));
    assert!(version_is_newer("v0.7.0-beta.2", "0.7.0-beta.1"));
    assert!(version_is_newer("v0.7.0-beta.1", "0.6.0"));
    // A higher core wins regardless of the suffix.
    assert!(version_is_newer("3.3.0-beta.2", "3.0.0"));
    // Build metadata is ignored, a hyphen inside it included; garbage never prompts.
    assert!(!version_is_newer("v0.6.0+build.5", "0.6.0"));
    assert!(version_is_newer("v1.0.0+build-5", "0.9.0"));
    assert!(!version_is_newer("v1.0.0+build-5", "1.0.0"));
    assert!(!version_is_newer("latest", "0.6.0"));
    assert!(!version_is_newer("v0.7.0", "unknown"));
    assert!(!version_is_newer("", ""));
}

#[test]
fn prerelease_identifiers_compare_numerically_then_lexically() {
    // Numeric identifiers rank below alphanumeric ones; a longer list outranks a prefix.
    assert!(version_is_newer("1.0.0-beta.10", "1.0.0-beta.9"));
    assert!(version_is_newer("1.0.0-beta", "1.0.0-1"));
    assert!(version_is_newer("1.0.0-rc.1", "1.0.0-beta.9"));
    assert!(version_is_newer("1.0.0-beta.1.1", "1.0.0-beta.1"));
    assert!(!version_is_newer("1.0.0-beta.1", "1.0.0-beta.1"));
    // Build metadata after a pre-release is ignored too.
    assert!(!version_is_newer("1.0.0-beta.1+exp", "1.0.0-beta.1"));
}

#[test]
fn parse_accepts_tags_and_plain_versions() {
    assert_eq!(parse_semver(" v1.2.3 "), Some(((1, 2, 3), Vec::new())));
    assert_eq!(
        parse_semver("1.2.3-rc.1+build"),
        Some(((1, 2, 3), vec!["rc".to_string(), "1".to_string()]))
    );
    assert_eq!(parse_semver("1.2.3+build-7"), Some(((1, 2, 3), Vec::new())));
    assert_eq!(
        parse_semver("1.2.3-rc.1+sha-abc"),
        Some(((1, 2, 3), vec!["rc".to_string(), "1".to_string()]))
    );
    assert_eq!(parse_semver("1.2"), None);
    assert_eq!(parse_semver("1.2.x"), None);
}
