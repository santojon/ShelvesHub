//! Preload mode — register the host runtime at document-start via browser-level
//! auto-attach, so it runs at idle boot (before the plugin renders) and its heavy
//! webpack enumeration never blocks a busy renderer.

use std::fs;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::cdp::{self, CdpClient};
use crate::config::Config;
use crate::logger::{log_error, log_info, log_warning};

use super::{FORCE_OWNER_GLOBAL, NATIVE_QAM_GLOBAL, OWNER_KIND};

// The document-start script runs BEFORE Steam's UI is up. It gates the boot on the
// SAME Steam lifecycle signal the loader's loader uses (a plugin loader frontend/index.ts):
//   window.App.BFinishedInitBeforeLogin() ?? window.App.BFinishedInitStageOne()
// This is a Steam-blessed "ready for plugins, before login/home" point — early
// enough that the runtime + plugin register BEFORE Steam builds the home nav tree
// and finalizes system-button input routing (the timing gap that broke VIEW/OPTIONS
// + edge-nav on a late inject), and safe (Steam is past stage-1 init, not mid-render
// — the loader does its full webpack scan here without collapsing). It replaces the old
// DOM-ready + rAF idle gate, which fired mid-boot and black-screened. Because the
// routerHook's afterPatch lands before the home route first renders, routes / home
// patch / recents-hide / edge-nav all take on first paint — no re-point needed.
const GATE_PREFIX: &str = r#"(function(){
function __shelvesSteamReady(){try{var a=window.App;return !!((a&&a.BFinishedInitBeforeLogin&&a.BFinishedInitBeforeLogin())||(a&&a.BFinishedInitStageOne&&a.BFinishedInitStageOne()))}catch(e){return false}}
function __shelvesBoot(){
"#;

const GATE_SUFFIX: &str = r#"
}
var __shBooted=false;function __shBootOnce(){if(__shBooted)return;__shBooted=true;try{__shelvesBoot()}catch(e){}}
if(__shelvesSteamReady()){__shBootOnce();}else{var __iv=setInterval(function(){if(__shelvesSteamReady()){clearInterval(__iv);__shBootOnce();}},16);}
setTimeout(__shBootOnce,120000);
})();
"#;

// The bundle is deferred until `window.__SHELVES_UI_READY__` so it never reads a
// half-populated `host.ui` — shared with the normal inject path (see the constants
// in the parent module).
use super::{BUNDLE_GATE_PREFIX, BUNDLE_GATE_SUFFIX};

/// Preload mode: register the host runtime at document-start on every (re)load
/// of the Steam renderer, via browser-level auto-attach. The runtime then runs
/// at idle boot — before the plugin loads and renders — so its heavy webpack
/// enumeration never blocks a busy renderer (the native-QAM late-inject failure
/// mode, where a blocked main thread starves the plugin's async shelf resolves
/// and tears the UI down). The registration lives as long as this process runs.
pub(super) fn run_preload(config: Config) {
    log_info(
        "loader",
        "Preload mode: host runtime runs at document-start (idle boot).",
    );
    let runtime = match fs::read_to_string(&config.host_runtime_path) {
        Ok(s) => s,
        Err(e) => {
            log_error(
                "loader",
                &format!(
                    "Preload: cannot read host runtime {}: {e}",
                    config.host_runtime_path.display()
                ),
            );
            return;
        }
    };
    // The sole host boots the plugin at idle boot too, so its home patch is in
    // place BEFORE the home first paints (a late inject misses that window). The
    // bundle's self-invoke gates it — dormant in coexistence (no `__SHELVES_HOST__`).
    let bundle = fs::read_to_string(&config.bundle_path).unwrap_or_default();

    // Compose the document-start script: opt-in stamps first (so the runtime sees
    // them the moment it evaluates), the per-locale dictionaries, then the runtime
    // (+ bundle) wrapped in the React-ready gate.
    let mut source = String::new();
    if config.force_owner {
        source.push_str(&format!("{FORCE_OWNER_GLOBAL} = {OWNER_KIND:?};\n"));
    }
    if config.native_qam {
        source.push_str(&format!("{NATIVE_QAM_GLOBAL} = true;\n"));
    }
    source.push_str(&super::config_stamp(&config));
    source.push_str(&super::i18n_stamp(&config.host_runtime_path));
    source.push_str(GATE_PREFIX);
    source.push_str(&runtime);
    if !bundle.is_empty() {
        // Defer the bundle's self-invoke until the runtime signals host.ui is ready.
        source.push_str(BUNDLE_GATE_PREFIX);
        source.push_str(&bundle);
        source.push_str(BUNDLE_GATE_SUFFIX);
    }
    source.push_str(GATE_SUFFIX);

    // A Steam restart tears down the CEF, dropping the browser connection —
    // reconnect and re-arm auto-attach each time. While Steam is DOWN the connect
    // fails immediately; retrying at a fixed fast cadence floods the CEF debug
    // endpoint with refused connects, which wedges it (EAGAIN) and then keeps the
    // Steam UI from coming back after the restart. So back off exponentially on
    // fast failures (Steam down) and reset once a session actually connects and
    // runs for a while (connected, then Steam later restarts).
    let base = Duration::from_millis(250);
    let max = Duration::from_secs(5);
    let mut delay = base;
    loop {
        let started = Instant::now();
        match preload_session(&config, &source) {
            Ok(()) => {}
            Err(e) => log_warning(
                "loader",
                &format!("Preload session dropped ({e}) — reconnecting…"),
            ),
        }
        if started.elapsed() < Duration::from_secs(2) {
            delay = (delay * 2).min(max); // fast failure → Steam is down; ease off
        } else {
            delay = base; // a real session ran → reset to the responsive cadence
        }
        thread::sleep(delay);
    }
}

/// Arm browser-level `Target.setAutoAttach` and register the document-start
/// script on matching pages. Returns Err when the browser connection drops.
fn preload_session(config: &Config, source: &str) -> cdp::Result<()> {
    let ws = cdp::browser_ws_url(&config.cef_host, config.cef_port)?;
    let mut client = CdpClient::connect(&ws)?;
    // `waitForDebuggerOnStart:false`: never leave a target paused (that wedges
    // the Steam UI); we register the document-start script as early as the
    // Target domain allows, which applies to that target's next document.
    //
    // Fire-and-forget via `send`, NOT `call`: `call` reads until it sees the
    // command's response id and DISCARDS every event that arrives meanwhile —
    // and `setAutoAttach` immediately emits `attachedToTarget` for targets that
    // ALREADY EXIST (the live SharedJSContext, and after a Steam restart the
    // fresh renderer, which usually comes up during our reconnect). `call` would
    // swallow exactly those attach events, so the poll loop below would never
    // register and the runtime would never run. `send` lets the response and all
    // `attachedToTarget` events (existing and new) flow to the poll loop.
    client.send(
        "Target.setAutoAttach",
        json!({ "autoAttach": true, "waitForDebuggerOnStart": false, "flatten": true }),
    )?;
    log_info(
        "loader",
        "Preload: browser auto-attach armed — watching page targets.",
    );
    let needle = config.target_filter.as_deref().map(|f| f.to_lowercase());
    loop {
        if let Some(msg) = client.poll_message()? {
            if msg.get("method").and_then(|m| m.as_str()) == Some("Target.attachedToTarget") {
                preload_attached(&mut client, &msg, source, needle.as_deref());
            }
        }
    }
}

/// One `Target.attachedToTarget`: register the document-start script on a
/// matching page, then always resume the (possibly paused) target.
fn preload_attached(client: &mut CdpClient, msg: &Value, source: &str, needle: Option<&str>) {
    let params = msg.get("params");
    let Some(sid) = params
        .and_then(|p| p.get("sessionId"))
        .and_then(Value::as_str)
    else {
        return;
    };
    let info = params.and_then(|p| p.get("targetInfo"));
    let ttype = info
        .and_then(|i| i.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let title = info
        .and_then(|i| i.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let url = info
        .and_then(|i| i.get("url"))
        .and_then(Value::as_str)
        .unwrap_or("");

    let matches = match needle {
        Some(n) => title.to_lowercase().contains(n) || url.to_lowercase().contains(n),
        None => {
            ttype == "page"
                && (title.to_lowercase().contains("sharedjscontext")
                    || url.contains("steamloopback"))
        }
    };
    let label = if title.is_empty() { url } else { title };
    log_info(
        "loader",
        &format!("Preload: attached type={ttype} \"{label}\" (match={matches})"),
    );
    if matches {
        let _ = client.send_on_session("Page.enable", json!({}), sid);
        // Runs at this target's NEXT document creation — the early-load path for a
        // fresh renderer whose document has not loaded yet.
        let _ = client.send_on_session(
            "Page.addScriptToEvaluateOnNewDocument",
            json!({ "source": source }),
            sid,
        );
        // Also run it NOW. When we attach to an ALREADY-LOADED renderer — the live
        // SharedJSContext, or a fresh one whose document loaded during our
        // reconnect — the doc-start hook above missed the current document, so
        // without this the runtime never runs until the next reload. The runtime's
        // gate defers its real boot to the right Steam lifecycle point, and its
        // `__shelvesRuntime` guard makes a later doc-start evaluation idempotent.
        let _ = client.send_on_session(
            "Runtime.evaluate",
            json!({ "expression": source, "userGesture": true, "awaitPromise": false }),
            sid,
        );
        log_info(
            "loader",
            &format!("Preload: registered + evaluated on \"{label}\""),
        );
    }
    // Harmless no-op unless a target happens to be waiting for a debugger.
    let _ = client.send_on_session("Runtime.runIfWaitingForDebugger", json!({}), sid);
}
