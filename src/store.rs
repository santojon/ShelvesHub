//! ShelvesHub's own persisted settings — distinct from the plugin's data.
//!
//! Writes are atomic (temp file + rename), the previous good copy is kept as a
//! rolling backup, and a load heals from that backup when the primary file is
//! missing or corrupt. So an interrupted write or a bad shutdown never loses or
//! corrupts the host's config — the same data-loss protection the plugin gives
//! its settings. Every load→modify→save goes through `update`, which serializes
//! the writers (RPC threads, the loop, sync) so none reverts another's change.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::logger::log_warning;

/// The host's user-facing settings (kept small and additive; `serde(default)`
/// keeps old/new files forward- and backward-compatible).
///
/// Update preferences form a two-level hierarchy: `auto_update` is the master
/// switch; the per-target switches (`auto_update_hub`, `auto_update_plugin`)
/// and their beta channels (`hub_prerelease`, `plugin_prerelease`) only take
/// effect while the master is on. Every switch defaults ON (the installers and
/// the README promise updates out of the box); the user turns them off. The
/// daemon combines these with the plugin's OWN update prefs (it honours the
/// plugin's toggles too), never overriding them.
///
/// Version-skew safety: `extra` (a `#[serde(flatten)]` catch-all) preserves any
/// keys a NEWER ShelvesHub wrote that this build doesn't know about, so an older
/// daemon reading then re-saving a newer config never silently drops the newer
/// fields — the host-side analog of the plugin's preserve-unknown sanitizer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct HubSettings {
    /// Master switch — whether the host keeps anything up to date on its own.
    pub auto_update: bool,
    /// Sub-switch: keep the ShelvesHub daemon itself up to date.
    pub auto_update_hub: bool,
    /// Sub-sub: draw the daemon's own updates from the pre-release channel.
    pub hub_prerelease: bool,
    /// Sub-switch: keep the Deck Shelves bundle (+ backend) up to date.
    pub auto_update_plugin: bool,
    /// Sub-sub: draw the bundle/backend from the pre-release channel.
    pub plugin_prerelease: bool,
    /// The release tag of the bundle the daemon last obtained/applied. Empty
    /// until the daemon itself downloads one. The auto-update check compares this
    /// to the latest release tag so it only re-downloads on an actual change (not
    /// every tick). Not user-facing.
    #[serde(default)]
    pub bundle_tag: String,
    /// The tag of the bundle kept as `.prev` by the last swap (what a rollback
    /// restores). Empty until a swap has happened.
    pub bundle_prev_tag: String,
    /// A Deck Shelves release the user rolled back from: the auto-update check
    /// leaves it alone until a newer release is published or the user updates by
    /// hand. Empty = no hold.
    pub bundle_hold_tag: String,
    /// The same hold for the hub's own release after a hub rollback.
    pub hub_hold_tag: String,
    /// Quiet updates: an automatic check never downloads or swaps while a game
    /// is running — it waits for a later tick. A manual "Check now" still goes
    /// ahead.
    pub quiet_updates: bool,
    /// The version that ran last. A different running version at start-up means
    /// an update (or a rollback) landed, and the user is told once.
    pub last_run_version: String,
    /// Whether the hub's own settings follow the Steam account across devices
    /// (see `sync`). On by default; device-local, never synced itself.
    pub config_sync: bool,
    /// Sync bookkeeping: the synced values as of the last round (to tell a local
    /// change apart), the per-key change stamps, and when the last round ran
    /// (ms since the epoch; 0 = never). Not user-facing.
    pub sync_base: serde_json::Map<String, serde_json::Value>,
    pub sync_stamps: std::collections::BTreeMap<String, u64>,
    pub sync_last_at: u64,
    /// The startup-movie slot names the hub itself placed (see `bootmovie`), so
    /// turning the movie off removes only those. Empty = nothing placed.
    pub boot_movie_slots: Vec<String>,
    /// Catch-all for keys written by a newer daemon — preserved verbatim across a
    /// load→save so a version-skewed downgrade can't drop them. Not read directly.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for HubSettings {
    fn default() -> Self {
        HubSettings {
            auto_update: true,
            auto_update_hub: true,
            hub_prerelease: false,
            auto_update_plugin: true,
            plugin_prerelease: false,
            bundle_tag: String::new(),
            bundle_prev_tag: String::new(),
            bundle_hold_tag: String::new(),
            hub_hold_tag: String::new(),
            quiet_updates: true,
            last_run_version: String::new(),
            config_sync: true,
            sync_base: serde_json::Map::new(),
            sync_stamps: std::collections::BTreeMap::new(),
            sync_last_at: 0,
            boot_movie_slots: Vec::new(),
            extra: serde_json::Map::new(),
        }
    }
}

/// Serializes every load→modify→save on the store. The RPC threads, the loop's
/// update check and sync all edit the same file, so without it one writer's
/// stale copy silently reverted another's change.
static STORE_LOCK: Mutex<()> = Mutex::new(());

/// Load the settings, apply `f`, and save them if `f` changed anything — all
/// under the store lock, so concurrent writers never lose each other's edits.
/// Returns the settings as saved (or as loaded, when nothing changed).
pub fn update(path: &Path, f: impl FnOnce(&mut HubSettings)) -> Result<HubSettings, String> {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let before = load(path);
    let mut settings = before.clone();
    f(&mut settings);
    if settings != before {
        save(path, &settings).map_err(|e| format!("save {}: {e}", path.display()))?;
    }
    Ok(settings)
}

/// Load the settings, healing from the backup when the primary file is missing
/// or corrupt. Never fails: an unreadable/absent store yields the defaults.
pub fn load(path: &Path) -> HubSettings {
    if let Some(s) = read_valid(path) {
        return s;
    }
    // Primary missing/corrupt — try the backup, and if it is good, restore it.
    if let Some(s) = read_valid(&backup_path(path)) {
        if let Err(e) = atomic_write(path, &serialize(&s)) {
            log_warning(
                "store",
                &format!(
                    "recovered settings from backup but could not rewrite {} ({e}) — using the backup this run.",
                    path.display()
                ),
            );
        }
        return s;
    }
    HubSettings::default()
}

/// Persist the settings atomically, first rolling the current good copy to the
/// backup — so an interrupted write is always recoverable on the next load.
pub fn save(path: &Path, settings: &HubSettings) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    if read_valid(path).is_some() {
        // Best-effort: a missing backup is not fatal — the atomic write below is
        // the real guarantee.
        let _ = fs::copy(path, backup_path(path));
    }
    atomic_write(path, &serialize(settings))
}

fn read_valid(path: &Path) -> Option<HubSettings> {
    let text = fs::read_to_string(path).ok()?;
    parse_lenient(&text)
}

/// Parse the store, dropping a known key whose value has the wrong type (it
/// falls back to its default) instead of treating the whole file as corrupt —
/// one bad field must not reset every other preference.
fn parse_lenient(text: &str) -> Option<HubSettings> {
    let mut v: serde_json::Value = serde_json::from_str(text).ok()?;
    if let Ok(s) = serde_json::from_value(v.clone()) {
        return Some(s);
    }
    let shape = serde_json::to_value(HubSettings::default()).ok()?;
    let shape = shape.as_object()?;
    let mistyped: Vec<String> = shape
        .iter()
        .filter(|(key, want)| {
            v.get(key.as_str())
                .is_some_and(|have| std::mem::discriminant(have) != std::mem::discriminant(want))
        })
        .map(|(key, _)| key.clone())
        .collect();
    let obj = v.as_object_mut()?;
    for key in &mistyped {
        obj.remove(key);
    }
    if let Ok(s) = serde_json::from_value(v.clone()) {
        note_ignored(&mistyped.join(", "));
        return Some(s);
    }
    // A value of the right outer type but a bad inner shape (e.g. a stamp that is
    // not a number): drop the single key whose removal makes the rest parse.
    for key in shape.keys().filter(|k| v.get(k.as_str()).is_some()) {
        let mut trial = v.clone();
        trial.as_object_mut()?.remove(key);
        if let Ok(s) = serde_json::from_value(trial) {
            note_ignored(key);
            return Some(s);
        }
    }
    None
}

static IGNORED_LOGGED: AtomicBool = AtomicBool::new(false);

/// Said once per process: the file is read on every setter and sync round, and
/// the next save rewrites the ignored key with its default anyway.
fn note_ignored(keys: &str) {
    if !IGNORED_LOGGED.swap(true, Ordering::Relaxed) {
        log_warning(
            "store",
            &format!("ignored malformed settings ({keys}) — defaults used until the next save."),
        );
    }
}

fn serialize(s: &HubSettings) -> String {
    serde_json::to_string_pretty(s).unwrap_or_else(|_| "{}".to_string())
}

/// `<file>.bak` beside the file. Shared with the config-file writer in `config`.
pub(crate) fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".bak");
    path.with_file_name(name)
}

/// Write to a temp file in the same directory, fsync, then rename over the
/// target. Rename is atomic on a POSIX filesystem, so a concurrent reader never
/// observes a half-written file. Shared with the config-file writer in `config`.
pub(crate) fn atomic_write(path: &Path, contents: &str) -> io::Result<()> {
    // One temp name per write (pid + counter), so two writers of the same file,
    // in this process or a second daemon, never truncate each other's temp.
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("config");
    let tmp = dir.join(format!(
        ".{stem}.{}.{}.tmp",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    let written = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    written
}

#[cfg(test)]
#[path = "tests/store_tests.rs"]
mod tests;
