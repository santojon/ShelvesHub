//! Injection loop.
//!
//! On every tick the loader connects to the Steam CEF renderer over the
//! DevTools protocol, checks whether the Deck Shelves bundle is already
//! executing, and injects it if not. The connection is re-established each
//! tick, so a Steam restart (renderer disappears and reappears under a fresh
//! marker-less context) is handled for free: the next probe returns `false`
//! and we re-inject.

use std::fs;
use std::path::Path;
use std::thread;
use std::time::Duration;

use serde_json::json;

use crate::cdp::{self, CdpClient};
use crate::config::Config;
use crate::logger::{log_error, log_info, log_warning};
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

/// Outcome of one injection cycle.
enum Tick {
    /// Bundle confirmed active in the renderer.
    Active,
    /// Injection ran but the marker did not confirm.
    NotConfirmed,
    /// Another host owns the renderer — nothing was injected on purpose.
    StoodDown(String),
}

/// Consecutive collapsed-UI observations before the loader halts injection and
/// (optionally) fires recovery. One interval of grace avoids reacting to the
/// brief windowless moment during a normal Steam restart.
const COLLAPSE_HALT_THRESHOLD: u32 = 2;

pub fn run(config: Config) {
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

    log_info("loader", "Injection loop started.");
    let interval = Duration::from_secs(config.interval_secs);
    let mut consecutive_collapse: u32 = 0;

    loop {
        // Health gate. The visible Steam UI lives in windows (Big Picture, Main
        // Menu, the Quick Access popup, …) that are separate targets from
        // `SharedJSContext`. When those windows are torn down the screen goes
        // black, yet `SharedJSContext` keeps answering evals — so probing the
        // renderer is a false health signal. Use the target list: a lone
        // `SharedJSContext` means the UI collapsed. Injecting into (or
        // `StartRestart`-ing) that state only makes it worse — so pause.
        let collapsed = match cdp::discover_targets(&config.cef_host, config.cef_port) {
            Ok(targets) => !cdp::ui_windows_present(&targets),
            // Discovery failure = renderer unreachable (Steam closed / mid-
            // restart), not a collapse; tick() reports the same and retries.
            Err(_) => false,
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

        match tick(&config) {
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
            Err(e) => {
                state::set_injected(false);
                // Renderer-not-ready is the common case (Steam closed, CEF
                // debugging not enabled yet) — warn, don't crash, retry next tick.
                log_warning("loader", &format!("Injection cycle skipped: {e}"));
            }
        }

        thread::sleep(interval);
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

/// One injection cycle.
fn tick(config: &Config) -> cdp::Result<Tick> {
    let mut client = CdpClient::connect_renderer(
        &config.cef_host,
        config.cef_port,
        config.target_filter.as_deref(),
    )?;

    // Enabling the Runtime domain is harmless and keeps parity with tooling
    // that listens for console events on the same target.
    let _ = client.call("Runtime.enable", json!({}));

    if probe_injected(&mut client)? {
        return Ok(Tick::Active);
    }

    // Coexistence guard: if another host's adapter already owns this renderer,
    // injecting would double-mount the plugin. Stand down unless ownership is
    // explicitly forced (the force stamp tells the other adapter to yield).
    let owner = probe_owner(&mut client)?;
    if !may_inject(&owner, config.force_owner) {
        return Ok(Tick::StoodDown(owner));
    }
    if config.force_owner {
        let stamp = format!("{FORCE_OWNER_GLOBAL} = {OWNER_KIND:?}; true");
        match client.evaluate(&stamp) {
            Ok(_) => log_info("loader", "Owner preference stamped (forced)."),
            Err(e) => log_warning("loader", &format!("Owner stamp failed: {e}")),
        }
    }
    // Native QAM opt-in: stamped before the runtime evaluates so it can pick
    // the native tab path (trip-breaker guarded; overlay stays the fallback).
    if config.native_qam {
        match client.evaluate(&format!("{NATIVE_QAM_GLOBAL} = true; true")) {
            Ok(_) => log_info("loader", "Native QAM stamp set."),
            Err(e) => log_warning("loader", &format!("Native QAM stamp failed: {e}")),
        }
    }

    log_warning("loader", "Bundle not detected — injecting.");

    // Inject the host runtime first so `window.__SHELVES_HOST__` (and QAM
    // support) is present before the bundle boots. Best-effort: if it is
    // missing we still inject the bundle (it can fall back to an inert host).
    inject_host_runtime(&mut client, config);

    let source = read_bundle(config)?;
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
    inject_bundle(&mut client, &source, env!("CARGO_PKG_VERSION"))?;

    // Confirm the marker is now present rather than trusting a silent eval.
    Ok(if probe_injected(&mut client)? {
        Tick::Active
    } else {
        Tick::NotConfirmed
    })
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

fn inject_host_runtime(client: &mut CdpClient, config: &Config) {
    match fs::read_to_string(&config.host_runtime_path) {
        Ok(source) => {
            // Inline the per-locale dictionaries first so the runtime's i18n reads
            // them the moment it evaluates.
            let source = format!("{}{}", i18n_stamp(&config.host_runtime_path), source);
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
    fn stands_down_for_foreign_owner() {
        assert!(!may_inject("other-host", false));
    }

    #[test]
    fn force_overrides_foreign_owner() {
        assert!(may_inject("other-host", true));
    }
}
