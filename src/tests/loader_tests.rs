// Unit tests for the `mod` module, extracted from mod.rs and attached
// via `#[cfg(test)] #[path = "../tests/loader_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

use super::*;

#[test]
fn a_loader_managed_copy_without_a_claim_is_never_joined_by_ours() {
    // The loader lists Deck Shelves but nothing claimed the renderer: a copy from
    // before the coexistence protocol — coexist with the tab only.
    assert!(loader_manages_unclaimed_plugin("", false, Some("3.2.0")));
    // Claimed renderers and forced ownership take their own paths.
    assert!(!loader_manages_unclaimed_plugin(
        OWNER_KIND,
        false,
        Some("3.2.0")
    ));
    assert!(!loader_manages_unclaimed_plugin(
        "other-host",
        false,
        Some("3.2.0")
    ));
    assert!(!loader_manages_unclaimed_plugin("", true, Some("3.2.0")));
    // A loader without Deck Shelves leaves the settle-then-host path alone.
    assert!(!loader_manages_unclaimed_plugin("", false, None));
}

#[test]
fn a_window_less_renderer_is_booting_only_while_young_and_never_seen_with_windows() {
    assert!(booting(false, Duration::from_secs(10)));
    assert!(!booting(true, Duration::from_secs(10))); // had windows: a real collapse
    assert!(!booting(false, BOOT_GRACE)); // grace over: counts as a collapse again
}

#[test]
fn hosting_beside_a_loader_needs_no_copy_listed_nor_installed_and_no_foreign_owner() {
    assert!(hosts_beside_loader(true, "", None, || false));
    assert!(hosts_beside_loader(true, OWNER_KIND, None, || false)); // ours (hot-swap)
    assert!(!hosts_beside_loader(true, "", None, || true)); // installed, not loaded yet
    assert!(!hosts_beside_loader(true, "", Some("3.3.4"), || false));
    assert!(!hosts_beside_loader(true, "other-host", None, || false));
    assert!(!hosts_beside_loader(false, "", None, || false)); // no loader: the sole path
}

#[test]
fn coop_offer_scripts_carry_the_key_and_the_bundle_we_offer() {
    let offer = coop_offer_script("v3.4.0", "0.6.0");
    assert!(offer.contains(COOP_OFFER_KEY));
    assert!(offer.contains("\"v3.4.0\""));
    assert!(offer.contains("\"0.6.0\""));
    assert!(offer.contains("fallbackAt"));
    let withdraw = coop_offer_withdraw_script();
    assert!(withdraw.contains(COOP_OFFER_KEY));
    assert!(withdraw.contains("removeItem"));
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
fn forced_ownership_waits_for_a_loader_before_hosting() {
    // Not forced: the configured window as before (0 = never settle).
    assert_eq!(settle_window(false, false, 0), 0);
    assert_eq!(settle_window(false, false, 5), 5);
    assert_eq!(settle_window(false, true, 5), 5);
    // Forced, loader already there: the cooperative branch owns it — no wait.
    assert_eq!(settle_window(true, true, 5), 0);
    // Forced, no loader yet: at least the loader window, never shorter than the configured one.
    assert_eq!(settle_window(true, false, 0), FORCE_LOADER_SETTLE_SECS);
    assert_eq!(settle_window(true, false, 5), FORCE_LOADER_SETTLE_SECS);
    assert_eq!(settle_window(true, false, 60), 60);
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

#[test]
fn same_version_ignores_the_v_prefix_and_an_empty_hold() {
    // A rollback hold is compared tag-to-version, so `v` must not matter.
    assert!(same_version("v0.6.0", "0.6.0"));
    assert!(same_version("0.6.0", "v0.6.0"));
    assert!(same_version("v3.4.0-beta.1", "v3.4.0-beta.1"));
    assert!(!same_version("v0.6.1", "v0.6.0"));
    assert!(!same_version("v0.6.0", ""));
}
