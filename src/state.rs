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
/// Per-boot RPC bearer token: generated once, stamped into the runtime over CDP
/// (the daemon's private channel) and required on every RPC call.
static RPC_TOKEN: OnceLock<String> = OnceLock::new();
/// Effective operational config snapshot (from `Config::summary`-style fields) +
/// the file it maps to, for the "advanced configuration" mirror. Set once at boot.
static RUNTIME_CONFIG: OnceLock<serde_json::Value> = OnceLock::new();
static CONFIG_FILE_PATH: OnceLock<PathBuf> = OnceLock::new();
static LOG_RING: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());
use crate::constants::defaults::LOG_RING_CAP;
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

/// Set when the binary staged over the running one is a ROLLBACK to the previous
/// ShelvesHub rather than a newer release, so the restart notice says so and the
/// update check leaves it in place until the restart.
static HUB_ROLLBACK_STAGED: AtomicBool = AtomicBool::new(false);

pub fn set_hub_rollback_staged(value: bool) {
    HUB_ROLLBACK_STAGED.store(value, Ordering::Relaxed);
}

pub fn hub_rollback_staged() -> bool {
    HUB_ROLLBACK_STAGED.load(Ordering::Relaxed)
}

/// Release notes of the pending ShelvesHub update, for the "what's new" preview
/// on the hub screen. `None` = no pending update (or none published).
static PENDING_HUB_NOTES: Mutex<Option<String>> = Mutex::new(None);

pub fn set_pending_hub_notes(notes: Option<String>) {
    if let Ok(mut slot) = PENDING_HUB_NOTES.lock() {
        *slot = notes.filter(|n| !n.is_empty());
    }
}

pub fn pending_hub_notes() -> Option<String> {
    PENDING_HUB_NOTES.lock().ok().and_then(|s| s.clone())
}

/// A Deck Shelves release the hub would install but is holding back (quiet
/// updates while a game runs), as `(tag, release notes)`. `None` = nothing pending.
static PENDING_PLUGIN_UPDATE: Mutex<Option<(String, String)>> = Mutex::new(None);

pub fn set_pending_plugin_update(update: Option<(String, String)>) {
    if let Ok(mut slot) = PENDING_PLUGIN_UPDATE.lock() {
        *slot = update;
    }
}

pub fn pending_plugin_update() -> Option<(String, String)> {
    PENDING_PLUGIN_UPDATE.lock().ok().and_then(|s| s.clone())
}

/// Whether the last automatic check held its downloads back because a game was
/// running (quiet updates). Surfaced via `getConfig` for the status row.
static UPDATE_DEFERRED: AtomicBool = AtomicBool::new(false);

pub fn set_update_deferred(value: bool) {
    UPDATE_DEFERRED.store(value, Ordering::Relaxed);
}

pub fn update_deferred() -> bool {
    UPDATE_DEFERRED.load(Ordering::Relaxed)
}

/// Host notices for the user — queued by the daemon (an update applied, a rollback
/// staged, a recovery run, …) and handed to the renderer runtime on the next settled
/// tick as (i18n key, params); the runtime words and shows them. Bounded.
static HOST_NOTICES: Mutex<Vec<(String, serde_json::Value)>> = Mutex::new(Vec::new());
const HOST_NOTICES_CAP: usize = 20;

pub fn push_host_notice(key: &str, params: serde_json::Value) {
    if let Ok(mut q) = HOST_NOTICES.lock() {
        if q.len() >= HOST_NOTICES_CAP {
            q.remove(0);
        }
        q.push((key.to_string(), params));
    }
}

/// Take every queued notice (empty when none).
pub fn drain_host_notices() -> Vec<(String, serde_json::Value)> {
    HOST_NOTICES
        .lock()
        .map(|mut q| std::mem::take(&mut *q))
        .unwrap_or_default()
}

/// Put undelivered notices back at the front (the renderer could not take them this tick).
pub fn requeue_host_notices(items: Vec<(String, serde_json::Value)>) {
    if let Ok(mut q) = HOST_NOTICES.lock() {
        let mut rest = std::mem::take(&mut *q);
        *q = items;
        q.append(&mut rest);
        q.truncate(HOST_NOTICES_CAP);
    }
}

/// Set by the RPC handlers when a synced setting changed here, so the loop runs a
/// sync round on the next settled tick instead of waiting for the periodic one.
static SYNC_REQUESTED: AtomicBool = AtomicBool::new(false);

pub fn request_sync() {
    SYNC_REQUESTED.store(true, Ordering::Relaxed);
}

/// Take the pending request (true at most once per request).
pub fn take_sync_request() -> bool {
    SYNC_REQUESTED.swap(false, Ordering::Relaxed)
}

/// Wall-clock millis (since epoch) of the most recent update check, so the hub
/// view can show "checked X ago". 0 = never checked this session.
static LAST_UPDATE_CHECK_MS: AtomicU64 = AtomicU64::new(0);

pub fn mark_update_checked_now() {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    LAST_UPDATE_CHECK_MS.store(ms, Ordering::Relaxed);
}

/// Millis elapsed since the last update check, or `None` if never checked.
pub fn millis_since_update_check() -> Option<u64> {
    let at = LAST_UPDATE_CHECK_MS.load(Ordering::Relaxed);
    if at == 0 {
        return None;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    now.checked_sub(at)
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

/// Coexistence auto-safe-mode: set when forced ownership kept coinciding
/// with confirmed UI collapses and the loop stood force down for the session.
/// In-memory only — a restart re-reads config and starts forced again. Surfaced
/// in diagnostics so the hub screen can explain why cooperative mode paused.
static COOP_RECEDED: AtomicBool = AtomicBool::new(false);

pub fn set_coop_receded(value: bool) {
    COOP_RECEDED.store(value, Ordering::Relaxed);
}

pub fn coop_receded() -> bool {
    COOP_RECEDED.load(Ordering::Relaxed)
}

/// Live state of the optional boot animation. Toggled by the `setBootMovie` RPC,
/// which installs or removes the movie immediately; the source WebM to install
/// from is fixed at boot. The atomic mirrors the config flag so the hub screen
/// echoes the current on/off without a restart.
static BOOT_MOVIE_ENABLED: AtomicBool = AtomicBool::new(false);
static BOOT_MOVIE_SOURCE: OnceLock<PathBuf> = OnceLock::new();

pub fn set_boot_movie_enabled(value: bool) {
    BOOT_MOVIE_ENABLED.store(value, Ordering::Relaxed);
}

pub fn boot_movie_enabled() -> bool {
    BOOT_MOVIE_ENABLED.load(Ordering::Relaxed)
}

pub fn set_boot_movie_source(path: PathBuf) {
    let _ = BOOT_MOVIE_SOURCE.set(path);
}

pub fn boot_movie_source() -> Option<&'static PathBuf> {
    BOOT_MOVIE_SOURCE.get()
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

/// The per-boot RPC token, generating it (256 bits of OS randomness, hex) on
/// first read. One value per process lifetime.
pub fn rpc_token() -> &'static str {
    RPC_TOKEN.get_or_init(|| {
        let mut buf = [0u8; 32];
        if getrandom::getrandom(&mut buf).is_err() {
            // Last-resort entropy — never expected on the supported OSes, but the
            // token must not be empty (an empty token would disable auth).
            let n = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            buf[..16].copy_from_slice(&n.to_le_bytes());
            buf[16..].copy_from_slice(&(std::process::id() as u128).to_le_bytes());
        }
        buf.iter().map(|b| format!("{b:02x}")).collect()
    })
}

/// Persist the per-boot RPC token to `path` (0600 on Unix) so a same-user
/// companion can read it. Best-effort: a failure just means the tray falls back
/// to reporting "can't reach the daemon" rather than acting — never fatal.
pub fn persist_rpc_token(path: &std::path::Path) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let wrote = std::fs::write(path, rpc_token()).is_ok();
    #[cfg(unix)]
    if wrote {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = wrote; // no file mode to tighten off Unix
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

/// The effective daemon config, stashed once at startup so the RPC server can run
/// an on-demand update check (`checkUpdates`) with the same inputs as the loop.
static DAEMON_CONFIG: OnceLock<crate::config::Config> = OnceLock::new();

pub fn set_daemon_config(config: crate::config::Config) {
    let _ = DAEMON_CONFIG.set(config);
}

pub fn daemon_config() -> Option<&'static crate::config::Config> {
    DAEMON_CONFIG.get()
}

/// A single-flight guard so the periodic loop and a manual `checkUpdates` RPC never
/// run an update check at the same time (both download + swap files). `try_begin`
/// returns false when a check is already in flight; `end` releases it.
static UPDATE_CHECK_RUNNING: AtomicBool = AtomicBool::new(false);

pub fn try_begin_update_check() -> bool {
    UPDATE_CHECK_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
}

pub fn end_update_check() {
    UPDATE_CHECK_RUNNING.store(false, Ordering::Release);
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

#[cfg(test)]
#[path = "tests/state_tests.rs"]
mod tests;
