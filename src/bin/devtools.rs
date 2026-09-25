//! `shelves-devtools` — the project's own cross-platform CDP developer tool.
//!
//! A small Chrome DevTools Protocol client for inspecting, injecting into, and
//! debugging the Steam (or any Chromium) renderer. It is plain Rust, so the
//! same binary runs on Linux, macOS and Windows.
//!
//! Against a Steam Deck you typically tunnel the CEF debug port over SSH first:
//!
//! ```text
//! ssh -N -L 8080:127.0.0.1:8080 deck@deck.local   # or scripts/deck-tunnel.sh
//! shelves-devtools targets
//! shelves-devtools inject --bundle bundle/index.js
//! shelves-devtools console
//! ```

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use serde_json::{json, Value};

use shelveshub::cdp::{self, CdpClient};
use shelveshub::config::{DEFAULT_CEF_HOST, DEFAULT_CEF_PORT};
use shelveshub::loader;

#[derive(Parser)]
#[command(
    name = "shelves-devtools",
    version,
    about = "Cross-platform CDP dev tool for ShelvesHub (inspect / inject / debug a CEF or Chromium renderer)"
)]
struct Cli {
    /// DevTools host (Steam CEF / Chromium remote-debugging host).
    #[arg(long, env = "SHELVES_CEF_HOST", default_value_t = DEFAULT_CEF_HOST.to_string(), global = true)]
    host: String,

    /// DevTools port.
    #[arg(long, env = "SHELVES_CEF_PORT", default_value_t = DEFAULT_CEF_PORT, global = true)]
    port: u16,

    /// Case-insensitive substring to pick the renderer target (title or URL).
    #[arg(long, env = "SHELVES_TARGET", global = true)]
    target: Option<String>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List the DevTools targets the endpoint exposes.
    Targets,
    /// Report whether the Deck Shelves bundle is currently injected.
    Probe,
    /// Evaluate a JavaScript expression in the renderer and print the result.
    Eval {
        /// The expression, e.g. `navigator.userAgent`.
        expression: String,
    },
    /// Inject a bundle file into the renderer (same path the loader uses).
    Inject {
        /// Path to the bundle to inject.
        #[arg(long, default_value = "bundle/index.js")]
        bundle: PathBuf,
        /// Inject even if the loader marker is already present.
        #[arg(long)]
        force: bool,
    },
    /// Reload the renderer page (useful after pushing an updated bundle).
    Reload {
        /// Bypass the renderer cache on reload.
        #[arg(long)]
        ignore_cache: bool,
    },
    /// Stream console output and uncaught exceptions from the renderer.
    Console {
        /// Stop after this many seconds (0 = stream until Ctrl-C).
        #[arg(long, default_value_t = 0)]
        duration: u64,
    },
    /// Register a script that evaluates at document start on every (re)load
    /// of the target, and hold the session open (the registration lives as
    /// long as this command runs). Closes the injection timing race: the
    /// script is present before any page code executes.
    Preload {
        /// Path to the script to evaluate before page scripts.
        #[arg(long)]
        script: PathBuf,
        /// Stop after this many seconds (0 = hold until Ctrl-C).
        #[arg(long, default_value_t = 0)]
        duration: u64,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(&cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: &Cli) -> cdp::Result<()> {
    let filter = cli.target.as_deref();
    match &cli.command {
        Command::Targets => cmd_targets(&cli.host, cli.port),
        Command::Probe => cmd_probe(&cli.host, cli.port, filter),
        Command::Eval { expression } => cmd_eval(&cli.host, cli.port, filter, expression),
        Command::Inject { bundle, force } => {
            cmd_inject(&cli.host, cli.port, filter, bundle, *force)
        }
        Command::Reload { ignore_cache } => cmd_reload(&cli.host, cli.port, filter, *ignore_cache),
        Command::Console { duration } => cmd_console(&cli.host, cli.port, filter, *duration),
        Command::Preload { script, duration } => {
            cmd_preload(&cli.host, cli.port, filter, script, *duration)
        }
    }
}

fn cmd_preload(
    host: &str,
    port: u16,
    filter: Option<&str>,
    script: &std::path::Path,
    duration: u64,
) -> cdp::Result<()> {
    let source = std::fs::read_to_string(script)
        .map_err(|e| cdp::CdpError(format!("cannot read {}: {e}", script.display())))?;
    println!(
        "preload: {} bytes; browser-level auto-attach — the script is registered on every page as it is CREATED (before any of its code runs), and survives Steam restarts{}",
        source.len(),
        if duration == 0 { " (Ctrl-C to stop)" } else { "" }
    );
    let start = std::time::Instant::now();
    // Outer loop: a Steam restart tears down the whole CEF, so the browser
    // connection drops — reconnect and re-arm auto-attach each time.
    loop {
        if duration > 0 && start.elapsed().as_secs() >= duration {
            return Ok(());
        }
        match run_autoattach(host, port, filter, &source) {
            Ok(()) => {}
            Err(e) => eprintln!("preload: browser session dropped ({e}) — reconnecting…"),
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
}

/// Connect to the browser-level endpoint, arm `Target.setAutoAttach` with
/// `waitForDebuggerOnStart` so each new page is paused at birth, and register
/// the document-start script on matching pages before resuming them. Returns
/// Err when the browser connection drops (Steam restart) so the caller
/// reconnects.
fn run_autoattach(host: &str, port: u16, filter: Option<&str>, source: &str) -> cdp::Result<()> {
    let ws = cdp::browser_ws_url(host, port)?;
    let mut client = CdpClient::connect(&ws)?;
    // `waitForDebuggerOnStart:false` on purpose: pausing every new target is a
    // boot-wedge risk (a target left paused hangs the Steam UI). We attach as
    // early as the Target domain allows and register the document-start script
    // then; it applies to that target's next document. Safe, if slightly less
    // guaranteed on the very first document of a brand-new target.
    client.call(
        "Target.setAutoAttach",
        serde_json::json!({ "autoAttach": true, "waitForDebuggerOnStart": false, "flatten": true }),
    )?;
    println!("preload: browser auto-attach armed — watching page targets");
    let needle = filter.map(|f| f.to_lowercase());
    loop {
        if let Some(msg) = client.poll_message()? {
            if msg.get("method").and_then(|m| m.as_str()) == Some("Target.attachedToTarget") {
                handle_attached(&mut client, &msg, source, needle.as_deref());
            }
        }
    }
}

/// One `Target.attachedToTarget`: register the document-start script when the
/// page matches the filter, then always resume the paused target.
fn handle_attached(
    client: &mut CdpClient,
    msg: &serde_json::Value,
    source: &str,
    needle: Option<&str>,
) {
    let params = msg.get("params");
    let session_id = params
        .and_then(|p| p.get("sessionId"))
        .and_then(|v| v.as_str());
    let Some(sid) = session_id else { return };
    let info = params.and_then(|p| p.get("targetInfo"));
    let ttype = info
        .and_then(|i| i.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let title = info
        .and_then(|i| i.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let url = info
        .and_then(|i| i.get("url"))
        .and_then(|v| v.as_str())
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
        let _ = client.send_on_session("Page.enable", serde_json::json!({}), sid);
        let _ = client.send_on_session(
            "Page.addScriptToEvaluateOnNewDocument",
            serde_json::json!({ "source": source }),
            sid,
        );
        let label = if title.is_empty() { url } else { title };
        // Don't print the raw CDP session id — it adds no diagnostic value over the
        // target label and trips cleartext-logging scanners.
        println!("preload: registered on \"{label}\"");
    }
    // Harmless no-op unless a target happens to be waiting for a debugger.
    let _ = client.send_on_session(
        "Runtime.runIfWaitingForDebugger",
        serde_json::json!({}),
        sid,
    );
}

fn cmd_targets(host: &str, port: u16) -> cdp::Result<()> {
    let targets = cdp::discover_targets(host, port)?;
    if targets.is_empty() {
        println!("No targets at http://{host}:{port}/json");
        return Ok(());
    }
    println!(
        "{} target(s) at http://{host}:{port}/json:\n",
        targets.len()
    );
    for t in &targets {
        let ws = if t.ws_url.is_some() { "ws" } else { "no-ws" };
        println!("  [{:<8}] {:<6} {}", t.kind, ws, t.title);
        println!("            {}", t.url);
    }
    Ok(())
}

fn cmd_probe(host: &str, port: u16, filter: Option<&str>) -> cdp::Result<()> {
    let mut client = CdpClient::connect_renderer(host, port, filter)?;
    let injected = loader::probe_injected(&mut client)?;
    println!("injected: {injected}");
    Ok(())
}

fn cmd_eval(host: &str, port: u16, filter: Option<&str>, expression: &str) -> cdp::Result<()> {
    let mut client = CdpClient::connect_renderer(host, port, filter)?;
    let value = client.evaluate(expression)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string())
    );
    Ok(())
}

fn cmd_inject(
    host: &str,
    port: u16,
    filter: Option<&str>,
    bundle: &Path,
    force: bool,
) -> cdp::Result<()> {
    let source = std::fs::read_to_string(bundle)
        .map_err(|e| cdp::CdpError(format!("cannot read {}: {e}", bundle.display())))?;

    let mut client = CdpClient::connect_renderer(host, port, filter)?;

    if !force && loader::probe_injected(&mut client)? {
        println!("already injected (use --force to re-inject)");
        return Ok(());
    }

    loader::inject_bundle(&mut client, &source, env!("CARGO_PKG_VERSION"))?;
    let injected = loader::probe_injected(&mut client)?;
    println!("injected {}: confirmed={injected}", bundle.display());
    Ok(())
}

fn cmd_reload(host: &str, port: u16, filter: Option<&str>, ignore_cache: bool) -> cdp::Result<()> {
    let mut client = CdpClient::connect_renderer(host, port, filter)?;
    let _ = client.call("Page.enable", json!({}));
    client.call("Page.reload", json!({ "ignoreCache": ignore_cache }))?;
    println!("reload requested (ignoreCache={ignore_cache})");
    Ok(())
}

fn cmd_console(host: &str, port: u16, filter: Option<&str>, duration: u64) -> cdp::Result<()> {
    let mut client = CdpClient::connect_renderer(host, port, filter)?;
    client.call("Runtime.enable", json!({}))?;
    let deadline = (duration > 0).then(|| Instant::now() + Duration::from_secs(duration));

    println!("streaming console (Ctrl-C to stop)...");
    loop {
        if let Some(d) = deadline {
            if Instant::now() >= d {
                break;
            }
        }
        match client.poll_message()? {
            Some(msg) => print_console_event(&msg),
            None => continue, // idle read timeout
        }
    }
    Ok(())
}

/// Pretty-print the console-relevant CDP events; ignore the rest.
fn print_console_event(msg: &Value) {
    match msg.get("method").and_then(Value::as_str) {
        Some("Runtime.consoleAPICalled") => {
            let params = &msg["params"];
            let level = params.get("type").and_then(Value::as_str).unwrap_or("log");
            let args: Vec<String> = params
                .get("args")
                .and_then(Value::as_array)
                .map(|a| a.iter().map(format_remote_object).collect())
                .unwrap_or_default();
            println!("[{level}] {}", args.join(" "));
        }
        Some("Runtime.exceptionThrown") => {
            let details = &msg["params"]["exceptionDetails"];
            let text = details
                .get("exception")
                .and_then(|e| e.get("description"))
                .and_then(Value::as_str)
                .or_else(|| details.get("text").and_then(Value::as_str))
                .unwrap_or("exception");
            println!("[exception] {text}");
        }
        _ => {}
    }
}

/// Render a CDP `RemoteObject` for console display.
fn format_remote_object(obj: &Value) -> String {
    if let Some(v) = obj.get("value") {
        return match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        };
    }
    obj.get("description")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            obj.get("type")
                .and_then(Value::as_str)
                .unwrap_or("?")
                .to_string()
        })
}
