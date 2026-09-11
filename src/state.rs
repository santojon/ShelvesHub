//! Shared injection state.
//!
//! The injection loop writes the latest observed state; the RPC server reads it
//! to answer `isInjected`. A plain atomic is enough — there is exactly one
//! writer (the loader loop) and many readers (RPC connections).

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static INJECTED: AtomicBool = AtomicBool::new(false);
static BUNDLE_READY: AtomicBool = AtomicBool::new(false);
/// Wall-clock millis (since epoch) of the most recent bundle injection, for the
/// cold-start measurement: `bundleReady` subtracts it to report the downstream
/// boot→initialised time. 0 = not injected yet this session.
static INJECTED_AT_MS: AtomicU64 = AtomicU64::new(0);
static POPULATE: OnceLock<(PathBuf, bool)> = OnceLock::new();
static HUB_CONFIG: OnceLock<PathBuf> = OnceLock::new();
/// Effective operational config snapshot (from `Config::summary`-style fields) +
/// the file it maps to, for the "advanced configuration" mirror. Set once at boot.
static RUNTIME_CONFIG: OnceLock<serde_json::Value> = OnceLock::new();
static CONFIG_FILE_PATH: OnceLock<PathBuf> = OnceLock::new();
static LOG_RING: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());
const LOG_RING_CAP: usize = 300;
/// The version tag of a newer ShelvesHub release detected while hosting with
/// hub auto-update on, when the daemon cannot yet replace its own running binary
/// in place. Surfaced via `getConfig` so the hub screen can show a "restart to
/// update" notice. `None` = no pending hub update.
static PENDING_HUB_UPDATE: Mutex<Option<String>> = Mutex::new(None);

/// Record (or clear) a pending ShelvesHub self-update the user must restart to
/// apply. Idempotent — the update check may set the same value each tick.
pub fn set_pending_hub_update(tag: Option<String>) {
    if let Ok(mut slot) = PENDING_HUB_UPDATE.lock() {
        *slot = tag;
    }
}

/// The pending ShelvesHub update version, if any (for `getConfig`).
pub fn pending_hub_update() -> Option<String> {
    PENDING_HUB_UPDATE.lock().ok().and_then(|s| s.clone())
}

/// Set once a hub self-update has been downloaded and staged over the running
/// binary but not yet applied (the daemon isn't under a relaunching service, so
/// it can't restart itself). Surfaced via `getConfig` so the notice becomes
/// "update downloaded — restart to finish" instead of "restart to update".
static HUB_UPDATE_STAGED: AtomicBool = AtomicBool::new(false);

pub fn set_hub_update_staged(value: bool) {
    HUB_UPDATE_STAGED.store(value, Ordering::Relaxed);
}

pub fn hub_update_staged() -> bool {
    HUB_UPDATE_STAGED.load(Ordering::Relaxed)
}

/// Troubleshooting: when set, the loader stands down (stops injecting) until the
/// service restarts. In-memory only, so a restart always clears it — "disable
/// until next restart". Toggled by the `setHostingPaused` RPC.
static HOSTING_PAUSED: AtomicBool = AtomicBool::new(false);

pub fn set_hosting_paused(value: bool) {
    HOSTING_PAUSED.store(value, Ordering::Relaxed);
}

pub fn hosting_paused() -> bool {
    HOSTING_PAUSED.load(Ordering::Relaxed)
}

/// Record whether the Deck Shelves bundle is currently active in the renderer.
pub fn set_injected(value: bool) {
    INJECTED.store(value, Ordering::Relaxed);
}

/// Stamp "the bundle was just injected" with the current wall-clock time, so the
/// bundleReady RPC can report how long the downstream boot took.
pub fn mark_injected_now() {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    INJECTED_AT_MS.store(ms, Ordering::Relaxed);
}

/// Millis elapsed since the last injection stamp, or `None` if never stamped /
/// the clock went backwards. Read once by bundleReady.
pub fn millis_since_injected() -> Option<u64> {
    let at = INJECTED_AT_MS.load(Ordering::Relaxed);
    if at == 0 {
        return None;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    now.checked_sub(at)
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

/// Record the effective operational-config snapshot + the config file it maps to
/// (for the advanced-configuration mirror). Set once at startup.
pub fn set_runtime_config(config_file: Option<PathBuf>, snapshot: serde_json::Value) {
    if let Some(p) = config_file {
        let _ = CONFIG_FILE_PATH.set(p);
    }
    let _ = RUNTIME_CONFIG.set(snapshot);
}

/// The effective operational-config snapshot recorded at startup, if any.
pub fn runtime_config() -> Option<&'static serde_json::Value> {
    RUNTIME_CONFIG.get()
}

/// The path the advanced-configuration editor writes to (`shelveshub.config.json`).
pub fn config_file_path() -> Option<&'static PathBuf> {
    CONFIG_FILE_PATH.get()
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

/// Clear the in-memory log ring (the `clearLogs` RPC / the fallback panel's
/// Clear action). Only the viewer's buffer is cleared — the on-disk daemon log
/// is untouched.
pub fn clear_logs() {
    if let Ok(mut ring) = LOG_RING.lock() {
        ring.clear();
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
