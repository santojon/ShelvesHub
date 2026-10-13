//! Optional boot animation: install the project's startup movie into Steam's
//! own startup-movie override slot, so the Deck UI plays it on launch. This is
//! Steam's native mechanism (a WebM under `config/uioverrides/movies/`), not an
//! overlay the host renders — the daemon just places (or removes) the file.
//!
//! Enabled by the `boot_movie` config flag. On every boot the daemon calls
//! `apply()`: when on, place the configured source WebM into
//! `<steam>/config/uioverrides/movies/` under each startup-movie name the
//! platform might play (see `slot_names`) and record those names in the hub
//! store; when off, remove only the recorded slots and any slot still holding
//! the hub's own movie — another tool's files stay. Steam picks a different
//! name per device (LCD Deck / OLED Deck / desktop Big Picture), so writing
//! every applicable name is what makes the override actually take effect.
//! Each slot is a symlink to the source (the same approach animation-manager
//! plugins use), falling back to a copy where symlinks aren't available. The
//! install/remove core is pure (`install_one`/`remove_ours`) so it unit-tests
//! against a temp dir without a real Steam install.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::logger::log_warning;
use crate::state;

/// Steam picks a different startup-movie file name per device/context, so an
/// override placed under one name is ignored where another is played:
/// `deck_startup.webm` (Steam Deck LCD), `oled_startup.webm` (Steam Deck OLED),
/// `bigpicture_startup.webm` (desktop Big Picture on macOS/Windows/Linux). We
/// install the same movie under every name the platform might play, so it takes
/// effect regardless of which one Steam chooses.
fn slot_names() -> &'static [&'static str] {
    if cfg!(target_os = "macos") || cfg!(windows) {
        &["bigpicture_startup.webm"]
    } else {
        // Linux / SteamOS: Steam ships several startup movies and plays a
        // different one by device/context, so cover them all — the small LCD/OLED
        // throbbers (deck/oled), the fullscreen SteamOS startups, and Big Picture
        // launched from desktop mode. Overriding every candidate is what makes the
        // animation take effect regardless of which one Gaming Mode actually reads.
        &[
            "deck_startup.webm",
            "oled_startup.webm",
            "steam_os_startup.webm",
            "steam_os_family_startup.webm",
            "bigpicture_startup.webm",
        ]
    }
}

fn home() -> Option<PathBuf> {
    env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

/// Steam's startup-movie override directory for this platform. The first
/// existing candidate wins; if none exist yet, the first candidate is returned
/// so `apply()` can create it. `None` only when even `HOME` is unresolved.
pub fn movies_dir() -> Option<PathBuf> {
    let rel = Path::new("config/uioverrides/movies");

    if cfg!(windows) {
        let base = env::var("ProgramFiles(x86)")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "C:\\Program Files (x86)".to_string());
        return Some(PathBuf::from(base).join("Steam").join(rel));
    }

    let home = home()?;
    let candidates: Vec<PathBuf> = if cfg!(target_os = "macos") {
        vec![home.join("Library/Application Support/Steam").join(rel)]
    } else {
        // Linux / SteamOS: `~/.steam/root` is the canonical symlink to the
        // Steam install; the flatpak / plain-install layouts are fallbacks.
        vec![
            home.join(".steam/root").join(rel),
            home.join(".local/share/Steam").join(rel),
            home.join(".steam/steam").join(rel),
        ]
    };
    let first = candidates[0].clone();
    Some(candidates.into_iter().find(|p| p.exists()).unwrap_or(first))
}

/// Place `source` into `movies_dir` under one slot name. Returns the installed
/// path. Pure over the directory + name — no environment lookups.
pub fn install_one(movies_dir: &Path, source: &Path, name: &str) -> Result<PathBuf, String> {
    if !source.exists() {
        return Err(format!("boot movie source missing: {}", source.display()));
    }
    fs::create_dir_all(movies_dir).map_err(|e| format!("create {}: {e}", movies_dir.display()))?;
    let dest = movies_dir.join(name);
    // Clear any existing file OR symlink first (Steam's default, or another
    // animation tool's link) so we never write through a link onto a foreign
    // target. `symlink_metadata` sees the link itself, dangling or not.
    if fs::symlink_metadata(&dest).is_ok() {
        fs::remove_file(&dest).map_err(|e| format!("clear {}: {e}", dest.display()))?;
    }
    place(source, &dest)?;
    Ok(dest)
}

/// Link the slot to `source` in place, the way animation managers do it, so Steam
/// reads the movie from where it lives. Falls back to a copy where symlinks are
/// unavailable (Windows without privilege, or a cross-device link).
#[cfg(unix)]
fn place(source: &Path, dest: &Path) -> Result<(), String> {
    let target = fs::canonicalize(source).unwrap_or_else(|_| source.to_path_buf());
    match std::os::unix::fs::symlink(&target, dest) {
        Ok(()) => Ok(()),
        Err(_) => fs::copy(source, dest)
            .map(|_| ())
            .map_err(|e| format!("copy {} -> {}: {e}", source.display(), dest.display())),
    }
}

#[cfg(not(unix))]
fn place(source: &Path, dest: &Path) -> Result<(), String> {
    fs::copy(source, dest)
        .map(|_| ())
        .map_err(|e| format!("copy {} -> {}: {e}", source.display(), dest.display()))
}

/// Install `source` under every slot name for this platform. Returns the primary
/// (first) installed path for logging.
pub fn install_to(movies_dir: &Path, source: &Path) -> Result<PathBuf, String> {
    let mut first: Option<PathBuf> = None;
    for name in slot_names() {
        let p = install_one(movies_dir, source, name)?;
        first.get_or_insert(p);
    }
    first.ok_or_else(|| "no startup-movie slots for this platform".to_string())
}

/// Remove one slot name this host installed, if present. Missing is success.
pub fn remove_one(movies_dir: &Path, name: &str) -> Result<(), String> {
    let dest = movies_dir.join(name);
    match fs::remove_file(&dest) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove {}: {e}", dest.display())),
    }
}

/// Whether the slot holds the hub's own movie: a link to `source`, or a copy
/// with the same bytes (the copy fallback, or a slot placed before the record
/// existed). A dangling link to our source counts; another tool's file never does.
fn holds_source(slot: &Path, source: &Path) -> bool {
    if let Ok(target) = fs::read_link(slot) {
        let canonical = fs::canonicalize(source).unwrap_or_else(|_| source.to_path_buf());
        return target == canonical || target == source;
    }
    let same_len = match (fs::metadata(slot), fs::metadata(source)) {
        (Ok(a), Ok(b)) => a.is_file() && a.len() == b.len(),
        _ => false,
    };
    same_len && matches!((fs::read(slot), fs::read(source)), (Ok(a), Ok(b)) if a == b)
}

/// Remove the slots this host placed: the `recorded` names, plus any slot still
/// holding the hub's own movie (placed before the record existed). Other tools'
/// files stay. Missing names succeed.
pub fn remove_ours(movies_dir: &Path, recorded: &[String], source: &Path) -> Result<(), String> {
    for name in slot_names() {
        let ours =
            recorded.iter().any(|r| r == name) || holds_source(&movies_dir.join(name), source);
        if ours {
            remove_one(movies_dir, name)?;
        }
    }
    Ok(())
}

/// Apply the `boot_movie` preference. `Ok(Some(path))` = installed there,
/// `Ok(None)` = removed / not installed. Best-effort: a resolvable-dir failure
/// is an error the caller logs, never a fatal daemon condition.
pub fn apply(enabled: bool, source: &Path) -> Result<Option<PathBuf>, String> {
    let dir =
        movies_dir().ok_or_else(|| "cannot resolve Steam movies dir (no HOME)".to_string())?;
    apply_in(&dir, enabled, source, &store_path())
}

/// The hub store that records the placed slots: the path published at boot, else
/// the same path resolved from the environment (the boot-time `apply` runs
/// before the daemon publishes it).
fn store_path() -> PathBuf {
    state::hub_config_path()
        .cloned()
        .unwrap_or_else(crate::config::hub_config_path_from_env)
}

/// `apply` over an explicit movies directory and store, so tests run against
/// temp directories.
fn apply_in(
    dir: &Path,
    enabled: bool,
    source: &Path,
    store: &Path,
) -> Result<Option<PathBuf>, String> {
    if enabled {
        let placed = install_to(dir, source);
        // Record what is in place now (even after a part-way failure), so a
        // later "off" clears exactly those slots.
        let ours = slot_names()
            .iter()
            .filter(|name| holds_source(&dir.join(name), source))
            .map(|name| name.to_string())
            .collect();
        record_slots(store, ours);
        placed.map(Some)
    } else {
        let recorded = crate::store::load(store).boot_movie_slots;
        remove_ours(dir, &recorded, source)?;
        record_slots(store, Vec::new());
        Ok(None)
    }
}

/// Persist the slot record; a no-op write when it is unchanged (every boot
/// passes through here).
fn record_slots(store: &Path, names: Vec<String>) {
    if let Err(e) = crate::store::update(store, |s| s.boot_movie_slots = names) {
        log_warning(
            "bootmovie",
            &format!("could not record the startup-movie slots: {e}"),
        );
    }
}

#[cfg(test)]
#[path = "tests/bootmovie_tests.rs"]
mod tests;
