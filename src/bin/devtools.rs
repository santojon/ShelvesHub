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

use shelves_loader::cdp::{self, CdpClient};
use shelves_loader::config::{DEFAULT_CEF_HOST, DEFAULT_CEF_PORT};
use shelves_loader::loader;

#[derive(Parser)]
#[command(
    name = "shelves-devtools",
    version,
    about = "Cross-platform CDP dev tool for Shelves Loader (inspect / inject / debug a CEF or Chromium renderer)"
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
        Command::Reload { ignore_cache } => {
            cmd_reload(&cli.host, cli.port, filter, *ignore_cache)
        }
        Command::Console { duration } => cmd_console(&cli.host, cli.port, filter, *duration),
    }
}

fn cmd_targets(host: &str, port: u16) -> cdp::Result<()> {
    let targets = cdp::discover_targets(host, port)?;
    if targets.is_empty() {
        println!("No targets at http://{host}:{port}/json");
        return Ok(());
    }
    println!("{} target(s) at http://{host}:{port}/json:\n", targets.len());
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
    println!("{}", serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()));
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
        .unwrap_or_else(|| obj.get("type").and_then(Value::as_str).unwrap_or("?").to_string())
}
