//! Shared injection state.
//!
//! The injection loop writes the latest observed state; the RPC server reads it
//! to answer `isInjected`. A plain atomic is enough — there is exactly one
//! writer (the loader loop) and many readers (RPC connections).

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

static INJECTED: AtomicBool = AtomicBool::new(false);
static BUNDLE_READY: AtomicBool = AtomicBool::new(false);
static POPULATE: OnceLock<(PathBuf, bool)> = OnceLock::new();
static HUB_CONFIG: OnceLock<PathBuf> = OnceLock::new();
static LOG_RING: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());
const LOG_RING_CAP: usize = 300;

/// Record whether the Deck Shelves bundle is currently active in the renderer.
pub fn set_injected(value: bool) {
    INJECTED.store(value, Ordering::Relaxed);
}

/// Whether the bundle was active as of the last loop tick.
pub fn is_injected() -> bool {
    INJECTED.load(Ordering::Relaxed)
}

/// Record that the injected bundle has fully initialised. Set from the RPC
/// server when the bundle calls `bundleReady`; distinct from `INJECTED` (which
/// the loop derives from the renderer probe) because it is the bundle's own
/// confirmation that it finished booting against the host API.
pub fn set_bundle_ready(value: bool) {
    BUNDLE_READY.store(value, Ordering::Relaxed);
}

/// Whether the bundle has confirmed full initialisation via `bundleReady`.
pub fn is_bundle_ready() -> bool {
    BUNDLE_READY.load(Ordering::Relaxed)
}

/// Record the bundle path + pre-release flag so RPC handlers (a manual
/// re-download from the fallback panel) can reach them. Set once at startup.
pub fn set_populate_config(bundle_path: PathBuf, prerelease: bool) {
    let _ = POPULATE.set((bundle_path, prerelease));
}

/// The `(bundle_path, prerelease)` recorded at startup, if any.
pub fn populate_config() -> Option<&'static (PathBuf, bool)> {
    POPULATE.get()
}

/// Record the ShelvesHub config-store path so RPC handlers (get/set config) can
/// reach it. Set once at startup.
pub fn set_hub_config_path(path: PathBuf) {
    let _ = HUB_CONFIG.set(path);
}

/// The ShelvesHub config-store path recorded at startup, if any.
pub fn hub_config_path() -> Option<&'static PathBuf> {
    HUB_CONFIG.get()
}

/// Append a formatted log line to the in-memory ring the `getLogs` RPC serves
/// (bounded — the oldest line drops). Called by the logger on every emit.
pub fn push_log(line: String) {
    if let Ok(mut ring) = LOG_RING.lock() {
        if ring.len() >= LOG_RING_CAP {
            ring.pop_front();
        }
        ring.push_back(line);
    }
}

/// The most recent `n` log lines (oldest first), for the `getLogs` RPC.
pub fn recent_logs(n: usize) -> Vec<String> {
    LOG_RING
        .lock()
        .map(|ring| {
            let start = ring.len().saturating_sub(n);
            ring.iter().skip(start).cloned().collect()
        })
        .unwrap_or_default()
}
