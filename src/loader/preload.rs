//! Preload mode — register the host runtime at document-start via browser-level
//! auto-attach, so it runs at idle boot (before the plugin renders) and its heavy
//! webpack enumeration never blocks a busy renderer.

use std::fs;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

use crate::cdp::{self, CdpClient};
use crate::config::Config;
use crate::logger::{log_error, log_info, log_warning};

use super::{FORCE_OWNER_GLOBAL, NATIVE_QAM_GLOBAL, OWNER_KIND};

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
    // Compose the document-start script: opt-in stamps first (so the runtime
    // sees them the moment it evaluates), then the runtime itself.
    let mut source = String::new();
    if config.force_owner {
        source.push_str(&format!("{FORCE_OWNER_GLOBAL} = {OWNER_KIND:?};\n"));
    }
    if config.native_qam {
        source.push_str(&format!("{NATIVE_QAM_GLOBAL} = true;\n"));
    }
    // Per-locale dictionaries, inlined before the runtime for its i18n.
    source.push_str(&super::i18n_stamp(&config.host_runtime_path));
    source.push_str(&runtime);

    // A Steam restart tears down the CEF, dropping the browser connection —
    // reconnect and re-arm auto-attach each time.
    loop {
        match preload_session(&config, &source) {
            Ok(()) => {}
            Err(e) => log_warning(
                "loader",
                &format!("Preload session dropped ({e}) — reconnecting…"),
            ),
        }
        thread::sleep(Duration::from_millis(250));
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
    client.call(
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
    if matches {
        let _ = client.send_on_session("Page.enable", json!({}), sid);
        let _ = client.send_on_session(
            "Page.addScriptToEvaluateOnNewDocument",
            json!({ "source": source }),
            sid,
        );
        let label = if title.is_empty() { url } else { title };
        log_info("loader", &format!("Preload: registered on \"{label}\""));
    }
    // Harmless no-op unless a target happens to be waiting for a debugger.
    let _ = client.send_on_session("Runtime.runIfWaitingForDebugger", json!({}), sid);
}
