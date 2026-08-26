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

/// The host's user-facing settings (kept small and additive; `serde(default)`
/// keeps old/new files forward- and backward-compatible).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct HubSettings {
    /// Whether the host keeps the Deck Shelves bundle up to date on its own.
    pub auto_update: bool,
}

/// Load the settings, healing from the backup when the primary file is missing
/// or corrupt. Never fails: an unreadable/absent store yields the defaults.
pub fn load(path: &Path) -> HubSettings {
    if let Some(s) = read_valid(path) {
        return s;
    }
    // Primary missing/corrupt — try the backup, and if it is good, restore it.
    if let Some(s) = read_valid(&backup_path(path)) {
        let _ = atomic_write(path, &serialize(&s));
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
    let stem = path.file_name().and_then(|s| s.to_str()).unwrap_or("config");
    let tmp = dir.join(format!(".{stem}.tmp"));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("shelveshub-store-{}-{name}", std::process::id()));
        let _ = fs::create_dir_all(&p);
        p.join("shelveshub.json")
    }

    fn cleanup(path: &Path) {
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(backup_path(path));
    }

    #[test]
    fn save_load_roundtrip() {
        let path = scratch("roundtrip");
        cleanup(&path);
        let s = HubSettings { auto_update: true };
        save(&path, &s).unwrap();
        assert_eq!(load(&path), s);
        cleanup(&path);
    }

    #[test]
    fn missing_file_is_defaults() {
        let path = scratch("missing");
        cleanup(&path);
        assert_eq!(load(&path), HubSettings::default());
    }

    #[test]
    fn corrupt_primary_heals_from_backup() {
        let path = scratch("corrupt");
        cleanup(&path);
        // First save establishes the file; second save rolls the first to .bak.
        save(&path, &HubSettings { auto_update: true }).unwrap();
        save(&path, &HubSettings { auto_update: false }).unwrap();
        // Corrupt the primary — the backup still holds the first (auto_update:true).
        fs::write(&path, "{ not valid json").unwrap();
        assert_eq!(load(&path), HubSettings { auto_update: true });
        // …and the heal rewrote a valid primary.
        assert_eq!(read_valid(&path), Some(HubSettings { auto_update: true }));
        cleanup(&path);
    }

    #[test]
    fn atomic_write_leaves_no_temp() {
        let path = scratch("atomic");
        cleanup(&path);
        save(&path, &HubSettings::default()).unwrap();
        let tmp = path.with_file_name(".shelveshub.json.tmp");
        assert!(!tmp.exists(), "temp file should be renamed away");
        cleanup(&path);
    }
}
