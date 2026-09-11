//! Injection loop.
//!
//! On every tick the loader connects to the Steam CEF renderer over the
//! DevTools protocol, checks whether the Deck Shelves bundle is already
//! executing, and injects it if not. The connection is re-established each
//! tick, so a Steam restart (renderer disappears and reappears under a fresh
//! marker-less context) is handled for free: the next probe returns `false`
//! and we re-inject.

use std::cmp::Ordering;
use std::fs;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::json;

use crate::cdp::{self, CdpClient};
use crate::config::Config;
use crate::logger::{log_error, log_info, log_warning};
use crate::populate;
use crate::state;

mod preload;

/// Global the loader sets in the renderer to mark a successful injection. The
/// probe reads it back; the bundle and `shelves-devtools probe` can too.
pub const MARKER_GLOBAL: &str = "window.__SHELVES_LOADER__";

/// Renderer global the plugin's host adapters use to claim single ownership.
/// The first adapter to mount sets it; everyone else stands down.
pub const OWNER_GLOBAL: &str = "window.__DECK_SHELVES_OWNER__";
/// Owner kind this host claims (and the value of `SHELVES_FORCE_OWNER`).
pub const OWNER_KIND: &str = "shelveshub";
/// Renderer global stamped before injection when ownership is forced, so the
/// other host's adapter can stand down cooperatively.
pub const FORCE_OWNER_GLOBAL: &str = "window.__SHELVES_FORCE_OWNER__";
/// Renderer global that opts the injected runtime into the native Quick
/// Access tab path (`SHELVES_NATIVE_QAM=1`). Read once at runtime boot.
pub const NATIVE_QAM_GLOBAL: &str = "window.__SHELVES_NATIVE_QAM__";

// The bundle reads `host.ui.*` at boot to render. On a sole host the runtime's
// UI discovery is CHUNKED (async — it yields so it never stalls the main thread),
// so `host.ui` is not fully populated the instant the runtime finishes; the
// runtime signals `window.__SHELVES_UI_READY__` when the scan lands. These wrap
// the bundle so its self-invoke is deferred until that signal — otherwise the
// bundle captures a half-empty `host.ui` (modals/menus/nav `undefined`) and its
// richer UI silently breaks. Coexist sets the flag synchronously (it borrows the
// loader's UI), so the gate boots immediately there.
pub(super) const BUNDLE_GATE_PREFIX: &str = "\nfunction __shelvesBootBundle(){\n";
pub(super) const BUNDLE_GATE_SUFFIX: &str = "\n}\nif(window.__SHELVES_UI_READY__){__shelvesBootBundle();}else{var __bn=0,__biv=setInterval(function(){if(window.__SHELVES_UI_READY__||++__bn>600){clearInterval(__biv);__shelvesBootBundle();}},20);}\n";

/// Outcome of one injection cycle.
enum Tick {
    /// Bundle confirmed active in the renderer.
    Active,
    /// Injection ran but the marker did not confirm.
    NotConfirmed,
    /// Another host owns the renderer and native-tab coexistence is off — nothing
    /// was injected on purpose.
    StoodDown(String),
    /// Another host owns the renderer; we added ONLY our native QAM tab alongside
    /// it (the host + bundle are left to the other loader). Carries the owner kind.
    CoexistTab(String),
    /// Renderer unclaimed and settling — waiting `owner_settle_secs` for another
    /// host to claim before we host it ourselves. Carries seconds waited so far.
    Settling(u64),
}

/// Consecutive collapsed-UI observations before the loader halts injection and
/// (optionally) fires recovery. One interval of grace avoids reacting to the
/// brief windowless moment during a normal Steam restart.
const COLLAPSE_HALT_THRESHOLD: u32 = 2;

pub fn run(mut config: Config) {
    // Obtain the bundle before anything else: the sole-host case (no loader, no
    // local bundle) still brings Deck Shelves up on its own — local → copy from
    // an installed plugin loader → download the newest release. Best-effort; on a
    // miss we keep whatever is at the path and injection reports it.
    match crate::populate::ensure_bundle(&config.bundle_path, config.prerelease) {
        Ok(src) => log_info("loader", &format!("Bundle ready via {src}.")),
        Err(e) => log_warning(
            "loader",
            &format!(
                "Could not obtain a bundle ({e}); injecting whatever is at {}.",
                config.bundle_path.display()
            ),
        ),
    }

    // Preload mode registers the runtime at document-start (idle boot) instead
    // of evaluating it into the live page — the safe path for the native QAM
    // tab, which must not run its heavy webpack walk on a busy renderer.
    if config.preload {
        return preload::run_preload(config);
    }

    // Resolve the CEF debug port: Steam usually exposes 8080, but it can vary; if
    // the configured port isn't answering at boot, fall back to the known ports.
    if let Some(p) = resolve_cef_port(&config.cef_host, config.cef_port) {
        if p != config.cef_port {
            log_info(
                "loader",
                &format!(
                    "CEF port {} not responding — using {p} instead.",
                    config.cef_port
                ),
            );
            config.cef_port = p;
        }
    }

    log_info("loader", "Injection loop started.");
    // Floor the poll interval at 1s. A background watcher never needs sub-second
    // polling, and a 0 (a stray/edited config, or the editable-config UI) would
    // busy-spin this loop — worse, when the renderer is unreachable it would
    // hammer connect() until the OS runs out of ephemeral ports (EADDRNOTAVAIL).
    let interval = Duration::from_secs(config.interval_secs.max(1));
    // While the bundle is NOT yet active (renderer still settling, not confirmed,
    // etc.) poll on a short interval so the first inject lands promptly after the
    // renderer appears — otherwise a renderer that settles just after a tick waits
    // a full `interval` (up to 30s) before hosting, the visible cold-start lag.
    // Once active (or coexisting), back off to the idle `interval` to keep CPU low.
    // `interval` is already >= 1s, so `fast` is too — never a spin.
    let fast = Duration::from_secs(2).min(interval);
    let mut consecutive_collapse: u32 = 0;
    // Tracks how long the renderer has been unclaimed, for the owner-settle guard
    // (`owner_settle_secs`): hold off owner-mode hosting until either a claim
    // appears (→ coexist) or the settle window elapses (→ sole host).
    let mut empty_since: Option<Instant> = None;
    // Throttle for the auto-update check (see auto_update_check): first check runs
    // on the first Active tick, then at most once per UPDATE_CHECK_INTERVAL.
    let mut last_update_check: Option<Instant> = None;
    // Tracks the troubleshooting pause so the transition INTO paused reloads once.
    let mut was_paused = false;
    // Consecutive target-discovery failures, to re-probe the CEF port if Steam
    // reappears on a different debug port than we resolved at boot.
    let mut discovery_fail_streak: u32 = 0;
    // Last-seen bundle file mtime, for the hot-swap watch: when the bundle on
    // disk changes (an auto-update download or an external replacement) we
    // re-inject it in place instead of reloading the whole renderer. Baselined
    // here — AFTER the initial obtain above — so the first host is not a "change".
    let mut last_bundle_mtime = bundle_mtime(&config.bundle_path);

    loop {
        // Health gate. The visible Steam UI lives in windows (Big Picture, Main
        // Menu, the Quick Access popup, …) that are separate targets from
        // `SharedJSContext`. When those windows are torn down the screen goes
        // black, yet `SharedJSContext` keeps answering evals — so probing the
        // renderer is a false health signal. Use the target list: a lone
        // `SharedJSContext` means the UI collapsed. Injecting into (or
        // `StartRestart`-ing) that state only makes it worse — so pause.
        let collapsed = match cdp::discover_targets(&config.cef_host, config.cef_port) {
            Ok(targets) => {
                discovery_fail_streak = 0;
                !cdp::ui_windows_present(&targets)
            }
            // Discovery failure = renderer unreachable (Steam closed / mid-
            // restart), not a collapse; tick() reports the same and retries.
            Err(_) => {
                discovery_fail_streak += 1;
                // Steam may have reappeared on a different debug port than the
                // one we resolved at boot; after a few misses, re-probe.
                if discovery_fail_streak >= 3 {
                    discovery_fail_streak = 0;
                    if let Some(p) = resolve_cef_port(&config.cef_host, config.cef_port) {
                        if p != config.cef_port {
                            log_info(
                                "loader",
                                &format!(
                                    "CEF port {} unreachable — switching to {p}.",
                                    config.cef_port
                                ),
                            );
                            config.cef_port = p;
                        }
                    }
                }
                false
            }
        };

        if collapsed {
            consecutive_collapse += 1;
            state::set_injected(false);
            log_warning(
                "loader",
                &format!(
                    "Steam UI windows absent (only SharedJSContext) — collapse #{consecutive_collapse}; screen is likely black. Injection paused."
                ),
            );
            // Fire once, when the collapse is confirmed (crosses the threshold).
            if consecutive_collapse == COLLAPSE_HALT_THRESHOLD {
                log_error(
                    "loader",
                    "Steam UI windows have collapsed. NOT calling StartRestart (it worsens this) — recover by restarting steam-launcher.service on the device.",
                );
                match &config.recover_cmd {
                    Some(cmd) => run_recovery(cmd),
                    None => log_error(
                        "loader",
                        "Auto-recovery disabled — run scripts/recover-deck.sh, or set SHELVES_RECOVER_CMD (e.g. `systemctl --user restart steam-launcher.service`).",
                    ),
                }
            }
            thread::sleep(interval);
            continue;
        }

        if consecutive_collapse >= COLLAPSE_HALT_THRESHOLD {
            log_info("loader", "Steam UI windows are back — resuming injection.");
        }
        consecutive_collapse = 0;

        // Troubleshooting pause (setHostingPaused): stand down until the service
        // restarts (the flag is in-memory). On the transition INTO paused, reload
        // the renderer once so the current injection is cleared and the user gets
        // a clean Steam. While paused we never inject.
        if state::hosting_paused() {
            if !was_paused {
                log_info(
                    "loader",
                    "Hosting paused (until restart) — standing down and reloading the renderer.",
                );
                reload_renderer(&config);
            }
            was_paused = true;
            state::set_injected(false);
            thread::sleep(interval);
            continue;
        }
        if was_paused {
            log_info("loader", "Hosting resumed.");
            was_paused = false;
        }

        let result = tick(&config, &mut empty_since);
        // Bundle hosted (Active) or the coexist tab is in place → idle cadence;
        // anything else means we still have work to do soon → fast cadence.
        let settled = matches!(&result, Ok(Tick::Active) | Ok(Tick::CoexistTab(_)));
        // We host the bundle ourselves (sole/owner) only on Active — NOT coexist,
        // where the plugin loader owns its own copy and must not be touched.
        let hosting = matches!(&result, Ok(Tick::Active));
        match result {
            Ok(Tick::Active) => {
                state::set_injected(true);
                log_info("loader", "Bundle active in renderer.");
            }
            Ok(Tick::NotConfirmed) => {
                state::set_injected(false);
                log_warning("loader", "Injection attempted but not confirmed.");
            }
            Ok(Tick::StoodDown(owner)) => {
                state::set_injected(false);
                log_info(
                    "loader",
                    &format!("Renderer owned by \"{owner}\" — standing down this tick."),
                );
            }
            Ok(Tick::CoexistTab(owner)) => {
                // Our bundle is not hosted here (the other loader owns it) — but our
                // native tab is added alongside. `injected` tracks OUR bundle, so it
                // stays false; the tab is purely additive.
                state::set_injected(false);
                log_info(
                    "loader",
                    &format!(
                        "Coexisting with \"{owner}\" — native QAM tab added alongside (host untouched)."
                    ),
                );
            }
            Ok(Tick::Settling(secs)) => {
                state::set_injected(false);
                log_info(
                    "loader",
                    &format!(
                        "Renderer unclaimed — settling {secs}s (waiting for another host to claim before hosting)."
                    ),
                );
            }
            Err(e) => {
                state::set_injected(false);
                // Renderer-not-ready is the common case (Steam closed, CEF
                // debugging not enabled yet) — warn, don't crash, retry next tick.
                log_warning("loader", &format!("Injection cycle skipped: {e}"));
            }
        }

        // When we host the bundle, periodically check for a newer Deck Shelves
        // release and apply it (if auto-update is enabled) so the plugin stays
        // current and its update banner clears. Throttled + best-effort.
        if hosting && last_update_check.is_none_or(|t| t.elapsed() >= UPDATE_CHECK_INTERVAL) {
            last_update_check = Some(Instant::now());
            auto_update_check(&config);
        }

        // Hot-swap watch: if the bundle on disk changed since the last tick — an
        // auto-update download just now, or an external replacement (a dev deploy) —
        // re-inject it IN PLACE rather than reloading the whole Steam UI. Only when
        // we host the bundle (Active); the marker clear makes the next tick re-inject,
        // and we drop to the fast cadence so the swap lands promptly.
        let mut swap_pending = false;
        let now_mtime = bundle_mtime(&config.bundle_path);
        let bundle_changed = now_mtime.is_some() && now_mtime != last_bundle_mtime;
        last_bundle_mtime = now_mtime;
        if hosting && bundle_changed && soft_reinject(&config) {
            log_info(
                "update",
                "Bundle changed on disk — hot-swapping in place (no renderer reload).",
            );
            swap_pending = true;
        }

        thread::sleep(if settled && !swap_pending {
            interval
        } else {
            fast
        });
    }
}

/// How often the daemon checks for a newer Deck Shelves release while hosting
/// with auto-update on. Rare on purpose: it hits the GitHub API and, on an actual
/// update, reloads the renderer.
const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(30 * 60);

/// When auto-update is enabled AND we host the bundle (sole/owner — never coexist,
/// where the plugin loader owns its own copy), compare the latest release tag for
/// the plugin channel to the tag we last installed; on a change, download the new
/// bundle, record the tag, and reload the renderer so the plugin reboots on it
/// (which clears its "update available" banner). Best-effort: any network/parse
/// miss is a silent no-op until the next check, and a working bundle is never
/// replaced unless a genuinely different release tag is published.
fn auto_update_check(config: &Config) {
    let mut settings = crate::store::load(&config.hub_config_path);
    if !settings.auto_update {
        state::set_pending_hub_update(None); // master off — clear any stale notice
        return;
    }
    // ── Plugin bundle: download + swap + reload on a newer release. ──
    if settings.auto_update_plugin {
        if let Some(latest) = populate::latest_release_tag(config.prerelease) {
            // Apply when we don't yet know what's installed (seed the tag) OR the
            // latest on the channel is strictly newer by SEMVER — never a downgrade
            // (so a newer beta is not replaced by an older stable on a channel switch,
            // and a same-core stable DOES supersede its beta).
            let apply =
                settings.bundle_tag.is_empty() || version_is_newer(&latest, &settings.bundle_tag);
            if apply && latest != settings.bundle_tag {
                log_info(
                    "update",
                    &format!(
                        "Deck Shelves update available (installed \"{}\" → latest \"{latest}\") — applying.",
                        settings.bundle_tag
                    ),
                );
                match populate::update_from_release(&config.bundle_path, config.prerelease) {
                    Ok(url) => {
                        settings.bundle_tag = latest;
                        if let Err(e) = crate::store::save(&config.hub_config_path, &settings) {
                            log_warning(
                                "update",
                                &format!("applied update but could not record tag: {e}"),
                            );
                        }
                        log_info(
                            "update",
                            &format!(
                                "Applied Deck Shelves update from {url}; hot-swapping in place."
                            ),
                        );
                        // No renderer reload: the download changed the bundle file,
                        // and the loop's on-disk watch hot-swaps it in place (clears
                        // the marker → the next tick re-injects the new bundle). See
                        // the bundle-mtime watch in `run`.
                    }
                    Err(e) => log_warning("update", &format!("update download failed: {e}")),
                }
            }
        }
    }
    // ── Hub itself: detect a newer release and record a "restart to update"
    //    notice. The in-place binary swap is scaffolded (populate::apply_hub_update)
    //    but not yet wired, so we notify rather than self-replace. ──
    if settings.auto_update_hub {
        check_hub_update(settings.hub_prerelease);
    } else {
        state::set_pending_hub_update(None);
    }
}

/// Hub self-update (scaffold): detect a newer ShelvesHub release for the channel
/// and record it (`state::set_pending_hub_update`) so the hub screen shows a
/// "restart to update" notice. The actual in-place binary swap lives in
/// `populate::apply_hub_update` (not yet implemented). Logs only when the pending
/// version changes, so the periodic re-check never spams the log.
fn check_hub_update(prerelease: bool) {
    let Some(latest) = populate::latest_hub_release_tag(prerelease) else {
        return; // network/parse miss — leave any existing notice as-is
    };
    let current = env!("CARGO_PKG_VERSION");
    if version_is_newer(&latest, current) {
        if state::pending_hub_update().as_deref() != Some(latest.as_str()) {
            log_info(
                "update",
                &format!(
                    "ShelvesHub {latest} available (running {current}) — restart to apply; in-place self-update pending."
                ),
            );
        }
        state::set_pending_hub_update(Some(latest));
    } else {
        state::set_pending_hub_update(None);
    }
}

/// True when release tag `latest` is a strictly newer version than the running
/// `current` (CARGO_PKG_VERSION) by SEMVER PRECEDENCE — so a pre-release is lower
/// than its release (`3.3.0-beta.2` < `3.3.0`), a higher core wins regardless of
/// suffix (`3.3.0-beta.2` > `3.0.0`), and two pre-releases order by their
/// identifiers (`beta.2` > `beta.1`). Channel selection (stable vs pre-release)
/// is separate — this only orders versions the channel already allows. An
/// unparseable version never prompts (a false negative only delays the notice).
fn version_is_newer(latest: &str, current: &str) -> bool {
    match (parse_semver(latest), parse_semver(current)) {
        (Some(l), Some(c)) => semver_precedence(&l, &c) == Ordering::Greater,
        _ => false,
    }
}

/// (major, minor, patch) + the dot-separated pre-release identifiers (empty = a
/// stable release). Build metadata (`+…`) is ignored, per semver.
type Semver = ((u64, u64, u64), Vec<String>);

fn parse_semver(s: &str) -> Option<Semver> {
    let s = s.trim().trim_start_matches('v');
    let (core, pre) = match s.split_once('-') {
        Some((c, p)) => (c, p.split('+').next().unwrap_or("")),
        None => (s.split('+').next().unwrap_or(s), ""),
    };
    let mut it = core.split('.');
    let major = it.next()?.parse().ok()?;
    let minor = it.next()?.parse().ok()?;
    let patch = it.next()?.parse().ok()?;
    let pre_ids = if pre.is_empty() {
        Vec::new()
    } else {
        pre.split('.').map(str::to_string).collect()
    };
    Some(((major, minor, patch), pre_ids))
}

fn semver_precedence(a: &Semver, b: &Semver) -> Ordering {
    match a.0.cmp(&b.0) {
        Ordering::Equal => {}
        core => return core,
    }
    // Equal core: a stable (no pre-release) outranks a pre-release of that core.
    match (a.1.is_empty(), b.1.is_empty()) {
        (true, true) => Ordering::Equal,
        (true, false) => Ordering::Greater,
        (false, true) => Ordering::Less,
        (false, false) => cmp_prerelease(&a.1, &b.1),
    }
}

/// Compare pre-release identifier lists (semver §11): numeric identifiers compare
/// numerically and rank below alphanumeric ones; a longer list outranks a prefix.
fn cmp_prerelease(a: &[String], b: &[String]) -> Ordering {
    for (x, y) in a.iter().zip(b.iter()) {
        let ord = match (x.parse::<u64>(), y.parse::<u64>()) {
            (Ok(nx), Ok(ny)) => nx.cmp(&ny),
            (Ok(_), Err(_)) => Ordering::Less,
            (Err(_), Ok(_)) => Ordering::Greater,
            (Err(_), Err(_)) => x.as_str().cmp(y.as_str()),
        };
        if ord != Ordering::Equal {
            return ord;
        }
    }
    a.len().cmp(&b.len())
}

/// Reload the renderer over CDP so a freshly-swapped bundle is picked up (the
/// daemon re-injects on the next tick into the reloaded page). Best-effort.
/// The debug ports to probe, in order: the configured one first, then Steam's
/// known alternates (8080/8081), de-duplicated so the configured port is never
/// probed twice.
fn port_candidates(configured: u16) -> Vec<u16> {
    let mut candidates = vec![configured];
    for p in [crate::config::DEFAULT_CEF_PORT, 8081] {
        if !candidates.contains(&p) {
            candidates.push(p);
        }
    }
    candidates
}

/// Probe the CEF debug port: try the configured port first, then Steam's known
/// alternates, returning the first that answers target discovery. `None` when
/// nothing responds (Steam not up yet) — the caller keeps whatever port it had
/// and the loop keeps retrying.
fn resolve_cef_port(host: &str, configured: u16) -> Option<u16> {
    port_candidates(configured)
        .into_iter()
        .find(|&p| cdp::discover_targets(host, p).is_ok())
}

/// Modified-time of the bundle file, or `None` if it can't be read — the input
/// to the hot-swap watch.
fn bundle_mtime(path: &Path) -> Option<std::time::SystemTime> {
    fs::metadata(path).ok().and_then(|m| m.modified().ok())
}

/// Hot-swap the bundle WITHOUT a full renderer reload: clear the injection marker
/// so the next tick re-injects the (new) runtime + bundle in place. The runtime's
/// installs are idempotent and the plugin re-registers its routes / QAM tab
/// cleanly on re-eval (verified on-device — routerHook re-adds and the tab
/// re-inserts with no error), so this re-runs Deck Shelves on the live renderer
/// instead of reloading all of Steam. Returns whether the marker was cleared.
fn soft_reinject(config: &Config) -> bool {
    match CdpClient::connect_renderer(
        &config.cef_host,
        config.cef_port,
        config.target_filter.as_deref(),
    ) {
        Ok(mut client) => match client.evaluate(&format!("delete {MARKER_GLOBAL}; true")) {
            Ok(_) => {
                state::set_injected(false);
                true
            }
            Err(e) => {
                log_warning("update", &format!("hot-swap (marker clear) failed: {e}"));
                false
            }
        },
        Err(e) => {
            log_warning("update", &format!("hot-swap connect failed: {e}"));
            false
        }
    }
}

fn reload_renderer(config: &Config) {
    match CdpClient::connect_renderer(
        &config.cef_host,
        config.cef_port,
        config.target_filter.as_deref(),
    ) {
        Ok(mut client) => {
            let _ = client.call("Page.enable", json!({}));
            if let Err(e) = client.call("Page.reload", json!({ "ignoreCache": false })) {
                log_warning("update", &format!("reload after update failed: {e}"));
            }
        }
        Err(e) => log_warning(
            "update",
            &format!("reload after update: cannot connect: {e}"),
        ),
    }
}

/// Fire the optional recovery command (`SHELVES_RECOVER_CMD`) as a detached
/// process. Best-effort: we log the launch outcome and let the next health
/// checks observe whether the UI windows come back. Deliberately fire-and-forget
/// so a slow/hanging recovery never blocks the injection loop.
fn run_recovery(cmd: &str) {
    match std::process::Command::new("sh").arg("-c").arg(cmd).spawn() {
        Ok(_) => log_info("loader", &format!("Recovery command launched: {cmd}")),
        Err(e) => log_error("loader", &format!("Recovery command failed to launch: {e}")),
    }
}

/// One injection cycle. `empty_since` carries the owner-settle clock across ticks
/// (see `owner_settle_secs`).
fn tick(config: &Config, empty_since: &mut Option<Instant>) -> cdp::Result<Tick> {
    let mut client = CdpClient::connect_renderer(
        &config.cef_host,
        config.cef_port,
        config.target_filter.as_deref(),
    )?;

    // Enabling the Runtime domain is harmless and keeps parity with tooling
    // that listens for console events on the same target.
    let _ = client.call("Runtime.enable", json!({}));

    if probe_injected(&mut client)? {
        *empty_since = None;
        return Ok(Tick::Active);
    }

    let owner = probe_owner(&mut client)?;

    // Foreign owner (another host + its Deck Shelves): coexist. We never install
    // the host or boot the bundle here — that would double-mount / hijack. But we
    // DO add our native QAM tab (additive, host-neutral) so ShelvesHub's tab shows
    // alongside. The injected runtime detects the other loader itself and takes the
    // tab-only path; the daemon just delivers it once. `!may_inject` is exactly "a
    // foreign owner, and we are not forcing".
    if !may_inject(&owner, config.force_owner) {
        *empty_since = None;
        if !config.native_qam {
            return Ok(Tick::StoodDown(owner));
        }
        if probe_coexist_tab(&mut client)? {
            return Ok(Tick::CoexistTab(owner)); // our tab is already present
        }
        stamp_native_qam(&mut client);
        inject_host_runtime(&mut client, config);
        return Ok(Tick::CoexistTab(owner));
    }

    // Unclaimed renderer, not forced: it may be a true sole host, or a coexistence
    // renderer a beat before the other host's adapter claims it. Injecting
    // owner-mode NOW would hijack that pending claim (the fast-tick failure mode).
    // Settle: wait up to `owner_settle_secs` for a claim to appear before hosting.
    // Default 0 disables the wait — a sole host boots immediately.
    if owner.is_empty() && !config.force_owner && config.owner_settle_secs > 0 {
        let now = Instant::now();
        let since = *empty_since.get_or_insert(now);
        let waited = now.duration_since(since).as_secs();
        if keep_settling(config.owner_settle_secs, waited) {
            return Ok(Tick::Settling(waited));
        }
    }
    *empty_since = None;

    // We host: our own claim, forced, or unclaimed past the settle window. Stamp
    // the opt-ins, inject the runtime (it installs `window.__SHELVES_HOST__` when it
    // finds no other loader), then the bundle.
    if config.force_owner {
        stamp_force_owner(&mut client);
    }
    if config.native_qam {
        stamp_native_qam(&mut client);
    }

    log_warning("loader", "Bundle not detected — injecting.");

    // Read the bundle off disk BEFORE evaluating the runtime, so the (multi-MB)
    // file read overlaps nothing that blocks it — and, more importantly, so the
    // bundle source is in hand to evaluate the instant the runtime returns (its
    // parse then overlaps the runtime's async UI scan, which gates only the
    // bundle's BOOT, not its parse). Phase timings are logged so the cold-start
    // budget is measurable (see the "Inject timing" line).
    let t_read = Instant::now();
    let source = read_bundle(config)?;
    let read_ms = t_read.elapsed().as_millis();

    // Inject the host runtime first so `window.__SHELVES_HOST__` (and QAM
    // support) is present before the bundle boots. Best-effort: if it is
    // missing we still inject the bundle (it can fall back to an inert host).
    let t_runtime = Instant::now();
    inject_host_runtime(&mut client, config);
    let runtime_ms = t_runtime.elapsed().as_millis();

    // Bundle compatibility check: never inject an empty/whitespace bundle — that
    // would stamp the loader marker over a no-op and mask a packaging problem.
    // A missing file is already rejected by `read_bundle`; this catches the
    // present-but-empty case with a clear, actionable log line.
    if source.trim().is_empty() {
        log_warning(
            "loader",
            &format!(
                "Bundle {} is empty — skipping injection.",
                config.bundle_path.display()
            ),
        );
        return Ok(Tick::NotConfirmed);
    }
    // Defer the bundle's boot until the runtime has populated `host.ui` (the
    // async chunked scan signals `__SHELVES_UI_READY__`); the runtime and bundle
    // are separate evaluates here, so without this the bundle boots before the
    // scan lands and captures a half-empty `host.ui`.
    let gated = format!("{BUNDLE_GATE_PREFIX}{source}{BUNDLE_GATE_SUFFIX}");
    let t_bundle = Instant::now();
    inject_bundle(&mut client, &gated, env!("CARGO_PKG_VERSION"))?;
    let bundle_ms = t_bundle.elapsed().as_millis();
    log_info(
        "loader",
        &format!(
            "Inject timing: bundle read {read_ms}ms, runtime eval {runtime_ms}ms, bundle eval {bundle_ms}ms. \
             (Bundle boot is then gated on the runtime's UI scan — see the runtime's \"UI scan complete\" line \
             and the bundleReady delta.)"
        ),
    );
    // Record when the bundle landed so the bundleReady RPC can report the
    // downstream boot→initialised time (the part after the daemon's own work).
    state::mark_injected_now();

    // Confirm the marker is now present rather than trusting a silent eval.
    Ok(if probe_injected(&mut client)? {
        Tick::Active
    } else {
        Tick::NotConfirmed
    })
}

/// Stamp the native-QAM opt-in global before the runtime evaluates, so it picks
/// the native tab path (trip-breaker guarded; overlay stays the fallback).
fn stamp_native_qam(client: &mut CdpClient) {
    match client.evaluate(&format!("{NATIVE_QAM_GLOBAL} = true; true")) {
        Ok(_) => log_info("loader", "Native QAM stamp set."),
        Err(e) => log_warning("loader", &format!("Native QAM stamp failed: {e}")),
    }
}

/// Stamp the force-owner global so a foreign adapter yields cooperatively.
fn stamp_force_owner(client: &mut CdpClient) {
    let stamp = format!("{FORCE_OWNER_GLOBAL} = {OWNER_KIND:?}; true");
    match client.evaluate(&stamp) {
        Ok(_) => log_info("loader", "Owner preference stamped (forced)."),
        Err(e) => log_warning("loader", &format!("Owner stamp failed: {e}")),
    }
}

/// True when our coexistence runtime has already added its tab. In coexistence the
/// runtime sets `window.__SHELVES_QAM__` but never the bundle marker
/// (`probe_injected`), so this is the distinct "tab already delivered" probe.
fn probe_coexist_tab(client: &mut CdpClient) -> cdp::Result<bool> {
    let value = client.evaluate("!!window.__SHELVES_QAM__")?;
    Ok(value.as_bool().unwrap_or(false))
}

/// Read the renderer's owner claim: empty string when unclaimed.
pub fn probe_owner(client: &mut CdpClient) -> cdp::Result<String> {
    let expr = format!("String({OWNER_GLOBAL} || \"\")");
    let value = client.evaluate(&expr)?;
    Ok(value.as_str().unwrap_or_default().to_string())
}

/// Injection is allowed when the renderer is unclaimed, already ours, or
/// ownership is forced. A foreign claim without force means stand down.
pub fn may_inject(owner: &str, force: bool) -> bool {
    owner.is_empty() || owner == OWNER_KIND || force
}

/// Whether an unclaimed renderer should keep settling (wait) rather than be hosted
/// yet. Enabled only when `settle_secs > 0`; ends once `waited_secs` reaches it, at
/// which point the renderer is treated as a true sole host.
fn keep_settling(settle_secs: u64, waited_secs: u64) -> bool {
    settle_secs > 0 && waited_secs < settle_secs
}

/// Evaluate the host runtime (`window.__SHELVES_HOST__`) in the renderer. The
/// runtime is idempotent, so re-evaluating on a later tick is harmless.
/// Compose a `window.__SHELVES_I18N__ = {…}` assignment from the per-locale JSON
/// files next to the runtime (`<runtime dir>/i18n/*.json`), so the injected
/// runtime — a blob that cannot read files — gets its dictionaries. Empty when
/// the directory is absent; the runtime then falls back to raw keys.
pub(super) fn i18n_stamp(host_runtime_path: &Path) -> String {
    let dir = match host_runtime_path.parent() {
        Some(p) => p.join("i18n"),
        None => return String::new(),
    };
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return String::new(),
    };
    let mut map = serde_json::Map::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let locale = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(dict) = serde_json::from_str::<serde_json::Value>(&content) {
                map.insert(locale, dict);
            }
        }
    }
    if map.is_empty() {
        return String::new();
    }
    format!(
        "window.__SHELVES_I18N__ = {};\n",
        serde_json::Value::Object(map)
    )
}

/// Expose the host-facing config to the runtime so it derives the RPC endpoint and
/// the contract version from the daemon (one source) instead of hardcoding them.
pub(super) fn config_stamp(config: &Config) -> String {
    let obj = serde_json::json!({
        "rpcEndpoint": format!("http://{}", config.rpc_addr),
        "hostApiVersion": crate::HOST_API_VERSION,
    });
    format!("window.__SHELVES_CONFIG__ = {obj};\n")
}

fn inject_host_runtime(client: &mut CdpClient, config: &Config) {
    // The runtime's trip breaker is now self-healing: it stamps each arm with a
    // timestamp and only trips on a STALE arm (a genuinely dead session), so a
    // boot double-inject (recent arm) re-arms instead of tripping. We must NOT clear
    // the trip here — doing so on every inject would wipe a legitimate trip and let
    // a crashing native path retry forever (a crash loop). The daemon health gate +
    // the runtime breaker together guard it.
    match fs::read_to_string(&config.host_runtime_path) {
        Ok(source) => {
            // Inline the per-locale dictionaries first so the runtime's i18n reads
            // them the moment it evaluates.
            let source = format!(
                "{}{}{}",
                config_stamp(config),
                i18n_stamp(&config.host_runtime_path),
                source
            );
            match client.evaluate(&source) {
                Ok(_) => log_info("loader", "Host runtime injected."),
                Err(e) => log_error("loader", &format!("Host runtime eval failed: {e}")),
            }
        }
        Err(e) => log_warning(
            "loader",
            &format!(
                "Host runtime not injected ({}): {e}",
                config.host_runtime_path.display()
            ),
        ),
    }
}

/// Read the bundle source, mapping IO errors into the CDP error type so the
/// caller can log+retry uniformly.
fn read_bundle(config: &Config) -> cdp::Result<String> {
    fs::read_to_string(&config.bundle_path).map_err(|e| {
        cdp::CdpError(format!(
            "cannot read bundle {}: {e}",
            config.bundle_path.display()
        ))
    })
}

/// Check the renderer for the loader marker.
pub fn probe_injected(client: &mut CdpClient) -> cdp::Result<bool> {
    let expr = format!("!!({MARKER_GLOBAL} && {MARKER_GLOBAL}.injected)");
    let value = client.evaluate(&expr)?;
    Ok(value.as_bool().unwrap_or(false))
}

/// Evaluate the bundle source in the renderer, then stamp the loader marker.
/// The marker is only written if the bundle evaluated without throwing, so the
/// probe never reports a half-injected state.
pub fn inject_bundle(client: &mut CdpClient, source: &str, version: &str) -> cdp::Result<()> {
    client.evaluate(source).map_err(|e| {
        log_error("loader", &format!("Bundle threw during injection: {e}"));
        e
    })?;

    let marker = format!(
        "{MARKER_GLOBAL} = {{ injected: true, version: {version:?}, at: Date.now() }}; true"
    );
    client.evaluate(&marker)?;
    log_info("loader", &format!("Bundle injected (v{version})."));
    Ok(())
}

#[cfg(test)]
mod tests {
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
}
