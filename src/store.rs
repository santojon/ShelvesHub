//! ShelvesHub's own persisted settings — distinct from the plugin's data.
//!
//! Writes are atomic (temp file + rename), the previous good copy is kept as a
//! rolling backup, and a load heals from that backup when the primary file is
//! missing or corrupt. So an interrupted write or a bad shutdown never loses or
//! corrupts the host's config — the same data-loss protection the plugin gives
//! its settings.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::logger::log_warning;

/// The host's user-facing settings (kept small and additive; `serde(default)`
/// keeps old/new files forward- and backward-compatible).
///
/// Update preferences form a two-level hierarchy: `auto_update` is the master
/// switch; the per-target switches (`auto_update_hub`, `auto_update_plugin`)
/// and their beta channels (`hub_prerelease`, `plugin_prerelease`) only take
/// effect while the master is on. The per-target switches default ON so that
/// enabling the master updates both targets without extra clicks. The daemon
/// combines these with the plugin's OWN update prefs (it honours the plugin's
/// toggles too), never overriding them.
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
    /// Catch-all for keys written by a newer daemon — preserved verbatim across a
    /// load→save so a version-skewed downgrade can't drop them. Not read directly.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for HubSettings {
    fn default() -> Self {
        // Master defaults OFF (opt-in); the per-target switches default ON so a
        // single master toggle covers both without further configuration.
        HubSettings {
            auto_update: false,
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
            extra: serde_json::Map::new(),
        }
    }
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
    serde_json::from_str(&text).ok()
}

fn serialize(s: &HubSettings) -> String {
    serde_json::to_string_pretty(s).unwrap_or_else(|_| "{}".to_string())
}

fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".bak");
    path.with_file_name(name)
}

/// Write to a temp file in the same directory, fsync, then rename over the
/// target. Rename is atomic on a POSIX filesystem, so a concurrent reader never
/// observes a half-written file.
fn atomic_write(path: &Path, contents: &str) -> io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("config");
    let tmp = dir.join(format!(".{stem}.tmp"));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

#[cfg(test)]
#[path = "tests/store_tests.rs"]
mod tests;
