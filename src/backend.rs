//! Python backend hosting.
//!
//! The real data methods (`get_settings`, `set_settings`, backups, …) are
//! Python in the Deck Shelves project. This module spawns that backend via
//! the runner script (`runtime/backend/shelveshub_backend.py`), supervises
//! the process, and proxies RPC calls to it over line-delimited JSON on
//! stdio.
//!
//! Design notes:
//! - stdout of the child is the protocol channel; stderr is forwarded line
//!   by line into our structured log, so backend logs land in the journal.
//! - Calls are serialized behind one mutex — the backend answers one request
//!   at a time. A hung call times out, kills the child, and the next call
//!   respawns it (with a cooldown so a crash-looping backend cannot spin).
//! - Method names are validated here as well as in the runner: only
//!   `[A-Za-z][A-Za-z0-9_]*` goes through, so lifecycle hooks (`_main`,
//!   `_unload`, …) and dunder lookups are never remotely callable.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::config::Config;
use crate::logger::{log_error, log_info, log_warning};

/// How long a single backend call may take before the child is presumed hung.
/// Generous because some methods do network work (wishlist, release download).
const CALL_TIMEOUT: Duration = Duration::from_secs(75);
/// Minimum time between spawn attempts, so a broken backend cannot crash-loop.
const RESPAWN_COOLDOWN: Duration = Duration::from_secs(10);

struct BackendSettings {
    python: String,
    runner: PathBuf,
    backend_dir: PathBuf,
    settings_dir: PathBuf,
}

struct Handle {
    child: Child,
    stdin: ChildStdin,
    responses: Receiver<Value>,
    next_id: u64,
}

struct State {
    handle: Option<Handle>,
    last_spawn: Option<Instant>,
}

static SETTINGS: OnceLock<BackendSettings> = OnceLock::new();
static STATE: Mutex<State> = Mutex::new(State {
    handle: None,
    last_spawn: None,
});

/// Configure backend hosting and eagerly spawn the child. No-op when
/// `SHELVES_BACKEND_DIR` is unset (backend hosting disabled).
pub fn init(config: &Config) {
    let Some(backend_dir) = &config.backend_dir else {
        log_info("backend", "No backend dir configured — data RPC disabled.");
        return;
    };
    let settings = BackendSettings {
        python: config.python_bin.clone(),
        runner: config.backend_runner_path.clone(),
        backend_dir: backend_dir.clone(),
        settings_dir: config.settings_dir.clone(),
    };
    if SETTINGS.set(settings).is_err() {
        return; // already initialised
    }
    let mut state = STATE.lock().unwrap();
    ensure_running(&mut state);
}

/// Whether backend hosting is configured (regardless of process health).
pub fn enabled() -> bool {
    SETTINGS.get().is_some()
}

/// Whether the backend child process is currently alive.
pub fn is_running() -> bool {
    let mut state = STATE.lock().unwrap();
    match state.handle.as_mut() {
        Some(h) => h.child.try_wait().ok().flatten().is_none(),
        None => false,
    }
}

/// Only plain public identifiers may cross into Python: no leading
/// underscore (lifecycle/private methods), no exotic characters.
pub fn valid_method_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    name.len() <= 64
        && first.is_ascii_alphabetic()
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Proxy one call to the Python backend. Serialized: one in-flight call at
/// a time. On transport failure the child is discarded so the next call can
/// respawn a fresh one.
pub fn call(method: &str, args: &Value) -> Result<Value, String> {
    if !valid_method_name(method) {
        return Err(format!("invalid method name: {method}"));
    }
    let mut state = STATE.lock().unwrap();
    if !ensure_running(&mut state) {
        return Err("backend is not running".to_string());
    }
    let handle = state.handle.as_mut().expect("ensure_running returned true");

    let id = handle.next_id;
    handle.next_id += 1;
    let request = json!({ "id": id, "method": method, "args": args }).to_string() + "\n";
    if let Err(e) = handle
        .stdin
        .write_all(request.as_bytes())
        .and_then(|_| handle.stdin.flush())
    {
        drop_handle(&mut state, &format!("write failed: {e}"));
        return Err("backend write failed".to_string());
    }

    let deadline = Instant::now() + CALL_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match handle.responses.recv_timeout(remaining) {
            Ok(response) => {
                // Stale replies (from a call that previously timed out) are
                // skipped until the matching id arrives.
                if response.get("id").and_then(Value::as_u64) != Some(id) {
                    continue;
                }
                let ok = response.get("ok").and_then(Value::as_bool).unwrap_or(false);
                if ok {
                    return Ok(response.get("result").cloned().unwrap_or(Value::Null));
                }
                let message = response
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown backend error")
                    .to_string();
                return Err(message);
            }
            Err(RecvTimeoutError::Timeout) => {
                drop_handle(&mut state, "call timed out");
                return Err(format!("backend call timed out: {method}"));
            }
            Err(RecvTimeoutError::Disconnected) => {
                drop_handle(&mut state, "process exited");
                return Err("backend exited mid-call".to_string());
            }
        }
    }
}

/// Make sure a live child exists, spawning one if allowed by the cooldown.
/// Returns false when hosting is unconfigured or the spawn failed.
fn ensure_running(state: &mut State) -> bool {
    let Some(settings) = SETTINGS.get() else {
        return false;
    };

    if let Some(handle) = state.handle.as_mut() {
        match handle.child.try_wait() {
            Ok(None) => return true, // still alive
            Ok(Some(status)) => log_warning("backend", &format!("Backend exited: {status}")),
            Err(e) => log_warning("backend", &format!("Backend status check failed: {e}")),
        }
        state.handle = None;
    }

    if let Some(last) = state.last_spawn {
        if last.elapsed() < RESPAWN_COOLDOWN {
            return false;
        }
    }
    state.last_spawn = Some(Instant::now());

    match spawn(settings) {
        Ok(handle) => {
            log_info(
                "backend",
                &format!("Backend started (pid {}).", handle.child.id()),
            );
            state.handle = Some(handle);
            true
        }
        Err(e) => {
            log_error("backend", &format!("Failed to start backend: {e}"));
            false
        }
    }
}

fn drop_handle(state: &mut State, reason: &str) {
    log_warning(
        "backend",
        &format!("Discarding backend process ({reason})."),
    );
    if let Some(mut handle) = state.handle.take() {
        let _ = handle.child.kill();
        let _ = handle.child.wait();
    }
}

fn spawn(settings: &BackendSettings) -> std::io::Result<Handle> {
    let mut child = Command::new(&settings.python)
        .arg(&settings.runner)
        .env("SHELVES_BACKEND_DIR", &settings.backend_dir)
        .env("SHELVES_SETTINGS_DIR", &settings.settings_dir)
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdin = child.stdin.take().expect("stdin was piped");
    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");

    // Protocol reader: parsed response objects flow to the caller in call().
    let (tx, rx) = mpsc::channel::<Value>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            match serde_json::from_str::<Value>(&line) {
                Ok(value) => {
                    if tx.send(value).is_err() {
                        break;
                    }
                }
                Err(_) => log_warning("backend", &format!("Non-protocol stdout line: {line}")),
            }
        }
    });

    // Backend log forwarder: whatever the backend writes to stderr becomes
    // journal-visible through our own logger.
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else { break };
            if !line.is_empty() {
                log_info("backend-py", &line);
            }
        }
    });

    Ok(Handle {
        child,
        stdin,
        responses: rx,
        next_id: 1,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_method_names() {
        assert!(valid_method_name("get_settings"));
        assert!(valid_method_name("listBackups2"));
    }

    #[test]
    fn rejects_private_and_malformed_names() {
        assert!(!valid_method_name(""));
        assert!(!valid_method_name("_main"));
        assert!(!valid_method_name("_unload"));
        assert!(!valid_method_name("9lives"));
        assert!(!valid_method_name("a.b"));
        assert!(!valid_method_name("a b"));
        assert!(!valid_method_name(&"x".repeat(65)));
    }

    #[test]
    fn call_without_configuration_fails_cleanly() {
        // SETTINGS is never initialised in unit tests, so any call must
        // report the backend as unavailable rather than panic.
        let result = call("get_settings", &Value::Null);
        assert_eq!(result.unwrap_err(), "backend is not running");
    }
}
