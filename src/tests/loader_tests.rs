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
fn the_token_restamp_only_touches_an_existing_config() {
    let script = restamp_token_script("abc");
    assert!(script.contains("window.__SHELVES_CONFIG__"));
    assert!(script.contains("\"abc\""));
    assert!(script.contains("if(c&&c.rpcToken!==t)"));
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

/// Evaluates the gated bundle twice while the UI scan is pending (an overlapping
/// re-inject), lets the scan land, and reports the boots and the stored handle.
const GATE_OVERLAP_RUNNER: &str = r#"
const fs = require("fs"); const vm = require("vm");
const gate = fs.readFileSync(process.argv[2], "utf8");
const ctx = { setInterval, clearInterval }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(gate, ctx); vm.runInContext(gate, ctx);
setTimeout(() => { ctx.__SHELVES_UI_READY__ = true;
  setTimeout(() => { const handle = ctx.__SHELVES_BUNDLE_GATE__;
    setTimeout(() => { console.log(JSON.stringify({ boots: ctx.__boots || 0, handle: handle === null }));
      process.exit(0); }, 300); }, 60); }, 100);
"#;

#[test]
fn the_bundle_gate_keeps_one_poll_interval_per_renderer() {
    // Static floor, checked with or without node: the gate clears an earlier poll,
    // keeps its own handle, boots at once when the scan already landed, and gives up
    // after 600 tries.
    assert!(BUNDLE_GATE_SUFFIX.contains("clearInterval(window.__SHELVES_BUNDLE_GATE__)"));
    assert!(BUNDLE_GATE_SUFFIX.contains("window.__SHELVES_BUNDLE_GATE__=__biv;"));
    assert!(BUNDLE_GATE_SUFFIX
        .starts_with("\n}\nif(window.__SHELVES_UI_READY__){__shelvesBootBundle();}"));
    assert!(BUNDLE_GATE_SUFFIX.contains("++__bn>600"));
    // Two gated evaluations overlapping inside the poll window: the second clears the
    // first one's interval, so the scan landing boots the bundle once and leaves no
    // interval behind (an orphan would re-run the bundle every 20 ms). Needs node.
    let dir = std::env::temp_dir().join(format!("shelveshub-gate-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let gate =
        format!("{BUNDLE_GATE_PREFIX}window.__boots=(window.__boots||0)+1;{BUNDLE_GATE_SUFFIX}");
    fs::write(dir.join("gate.js"), gate).unwrap();
    fs::write(dir.join("run.js"), GATE_OVERLAP_RUNNER).unwrap();
    let run = std::process::Command::new("node")
        .arg(dir.join("run.js"))
        .arg(dir.join("gate.js"))
        .output();
    let _ = fs::remove_dir_all(&dir);
    let Ok(out) = run else {
        eprintln!("skipped: node not available, the overlap run did not execute");
        return;
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(stdout.trim(), r#"{"boots":1,"handle":true}"#);
}

#[test]
fn a_newer_release_never_unstages_the_one_already_staged() {
    let _serial = crate::state::UPDATE_GUARD_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    state::set_hub_rollback_staged(false);
    state::set_hub_update_staged(true);
    state::set_pending_hub_update(Some("v90.0.0".to_string()));
    state::set_pending_hub_notes(Some("staged notes".to_string()));
    // A newer release while a game runs: the staged binary still runs at the next
    // restart, so its flag, notice and notes stay (deferred, so no download).
    handle_hub_release("v90.1.0", "newer notes".to_string(), "", false, true);
    assert!(state::hub_update_staged());
    assert_eq!(state::pending_hub_update().as_deref(), Some("v90.0.0"));
    assert_eq!(state::pending_hub_notes().as_deref(), Some("staged notes"));
    // Nothing staged: the deferred release becomes the pending one, with its notes.
    state::set_hub_update_staged(false);
    handle_hub_release("v90.1.0", "newer notes".to_string(), "", false, true);
    assert!(!state::hub_update_staged());
    assert_eq!(state::pending_hub_update().as_deref(), Some("v90.1.0"));
    assert_eq!(state::pending_hub_notes().as_deref(), Some("newer notes"));
    // A held-back release clears an un-staged notice.
    handle_hub_release("v90.1.0", "newer notes".to_string(), "v90.1.0", false, true);
    assert!(state::pending_hub_update().is_none());
    assert!(state::pending_hub_notes().is_none());
}

#[test]
fn a_staged_hub_update_keeps_its_notice_when_the_switches_turn_off() {
    let _serial = crate::state::UPDATE_GUARD_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let dir = std::env::temp_dir().join(format!("shelveshub-staged-notice-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let mut config = Config::from_env();
    config.hub_config_path = dir.join("shelveshub.json");
    let hub_off = crate::store::HubSettings {
        auto_update: true,
        auto_update_hub: false,
        auto_update_plugin: false,
        ..Default::default()
    };
    crate::store::save(&config.hub_config_path, &hub_off).unwrap();
    state::set_hub_update_staged(true);
    state::set_hub_rollback_staged(false);
    state::set_pending_hub_update(Some("v9.9.9".to_string()));
    state::set_pending_hub_notes(Some("notes".to_string()));
    // The hub switch off, then the master off: the staged binary still applies at
    // the next restart, so its notice stays (a manual check skips the game probe).
    auto_update_check(&config, false, false, true);
    assert_eq!(state::pending_hub_update().as_deref(), Some("v9.9.9"));
    assert_eq!(state::pending_hub_notes().as_deref(), Some("notes"));
    assert!(state::hub_update_staged());
    let master_off = crate::store::HubSettings {
        auto_update: false,
        ..Default::default()
    };
    crate::store::save(&config.hub_config_path, &master_off).unwrap();
    auto_update_check(&config, false, false, true);
    assert_eq!(state::pending_hub_update().as_deref(), Some("v9.9.9"));
    // Nothing staged: the switches clear a stale notice as before.
    state::set_hub_update_staged(false);
    auto_update_check(&config, false, false, true);
    assert!(state::pending_hub_update().is_none());
    assert!(state::pending_hub_notes().is_none());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_loader_copy_that_claimed_under_an_earlier_force_is_never_joined_by_ours() {
    // Our own claim, not forcing, the loader lists its copy: the claim is that copy's.
    assert!(loader_copy_holds_our_claim(
        OWNER_KIND,
        false,
        Some("3.3.4")
    ));
    // Forced: the cooperative branch owns the decision.
    assert!(!loader_copy_holds_our_claim(
        OWNER_KIND,
        true,
        Some("3.3.4")
    ));
    // No loader copy listed: the claim is ours (a hot-swap re-inject, or beside a loader).
    assert!(!loader_copy_holds_our_claim(OWNER_KIND, false, None));
    // Unclaimed and foreign claims take their own paths.
    assert!(!loader_copy_holds_our_claim("", false, Some("3.3.4")));
    assert!(!loader_copy_holds_our_claim(
        "other-host",
        false,
        Some("3.3.4")
    ));
}

#[test]
fn the_offer_carries_the_recorded_tag_then_the_embedded_version() {
    assert_eq!(
        offered_bundle_version("v3.4.0", true, Some("3.3.4")).as_deref(),
        Some("v3.4.0")
    );
    assert_eq!(
        offered_bundle_version("", true, Some("3.3.4")).as_deref(),
        Some("3.3.4")
    );
    // A real bundle with no readable version: nothing worth offering.
    assert_eq!(offered_bundle_version("", true, None), None);
    // No real bundle on disk: nothing to offer, whatever else is known.
    assert_eq!(offered_bundle_version("", false, Some("3.3.4")), None);
    // A recorded tag is authoritative even without a real file (the download recorded it).
    assert_eq!(
        offered_bundle_version("v3.4.0", false, None).as_deref(),
        Some("v3.4.0")
    );
}

#[test]
fn the_bundle_version_marker_reads_release_and_development_builds() {
    // Minified release: the manifest's name and version sit next to each other.
    let release = b"var DeckShelvesBundle=(function(No){...\"deck-shelves\",ABn=\"3.3.4\",zBn=\"A plugin that injects shelves\"...";
    assert_eq!(bundle_version_marker(release).as_deref(), Some("3.3.4"));
    // Development build: one assignment per line, with a pre-release tail.
    let dev = b"\t\tname = \"deck-shelves\";\n\t\tversion$1 = \"3.4.0-beta.1\";\n\t\tdescription = \"A plugin\";";
    assert_eq!(bundle_version_marker(dev).as_deref(), Some("3.4.0-beta.1"));
    // Other mentions of the name (a settings-file stem, a panel id) carry no version:
    // skipped, and the real marker later in the file still wins.
    let mixed = b"\"deck-shelves\";return t.toLowerCase().endsWith(\".json\")?t:`${t}.json`} \
        {name:\"deck-shelves\",title:x} \"deck-shelves\",Q=\"3.5.0\"";
    assert_eq!(bundle_version_marker(mixed).as_deref(), Some("3.5.0"));
    // No marker at all (an example bundle), and a version too far from the name.
    assert_eq!(
        bundle_version_marker(b"(function(){window.__ds=1;})();"),
        None
    );
    let far = [&b"\"deck-shelves\""[..], &[b' '; 80][..], &b"\"3.3.4\""[..]].concat();
    assert_eq!(bundle_version_marker(&far), None);
}

#[test]
fn the_loader_probe_reads_the_same_globals_as_the_runtime() {
    // The probe reads exactly the globals `otherLoaderPresent` in runtime/shelves-host.js
    // reads, minus the plugin's own development stamp (a copy this daemon hosts sets it).
    let runtime = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/runtime/shelves-host.js"
    ))
    .unwrap();
    let start = runtime
        .find("function otherLoaderPresent()")
        .expect("the runtime's probe");
    let body = &runtime[start..];
    let body = &body[..body.find("catch (e)").expect("the probe's end")];
    let runtime_globals: Vec<&str> = idents_after(body, "w.")
        .into_iter()
        .filter(|g| *g != "__ds_build")
        .collect();
    let probe_globals = idents_after(LOADER_PRESENT_PROBE, "window.");
    assert!(runtime_globals.len() >= 4, "{runtime_globals:?}");
    for g in &runtime_globals {
        assert!(probe_globals.contains(g), "the probe does not read {g}");
    }
    for g in &probe_globals {
        assert!(runtime_globals.contains(g), "the runtime does not read {g}");
    }
    assert!(!LOADER_PRESENT_PROBE.contains("__ds_build"));
}

/// The identifiers following each `prefix` in `source` (`w.DFL.definePlugin` yields `DFL`).
fn idents_after<'a>(source: &'a str, prefix: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut rest = source;
    while let Some(at) = rest.find(prefix) {
        let tail = &rest[at + prefix.len()..];
        let len = tail
            .bytes()
            .take_while(|b| b.is_ascii_alphanumeric() || *b == b'_')
            .count();
        if len > 0 {
            out.push(&tail[..len]);
        }
        rest = &tail[len..];
    }
    out
}

#[test]
fn the_desktop_gate_trusts_steams_ui_mode_before_window_visibility() {
    // Big Picture open but occluded (macOS marks the window hidden): still on screen.
    assert!(gamepad_ui_on_screen(&json!({ "mode": 4, "shown": false })));
    // The desktop client, even with a visible window: stand down.
    assert!(!gamepad_ui_on_screen(&json!({ "mode": 7, "shown": true })));
    assert!(!gamepad_ui_on_screen(&json!({ "mode": 0, "shown": true })));
    // No mode (an older client, or an unknown answer): the visibility decides.
    assert!(gamepad_ui_on_screen(
        &json!({ "mode": null, "shown": true })
    ));
    assert!(!gamepad_ui_on_screen(
        &json!({ "mode": -1, "shown": false })
    ));
    // Nothing readable at all fails open, like a probe error.
    assert!(gamepad_ui_on_screen(
        &json!({ "mode": null, "shown": null })
    ));
    assert!(gamepad_ui_on_screen(&json!({})));
}
