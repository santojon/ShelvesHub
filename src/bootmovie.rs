//! Optional boot animation: install the project's startup movie into Steam's
//! own startup-movie override slot, so the Deck UI plays it on launch. This is
//! Steam's native mechanism (a WebM under `config/uioverrides/movies/`), not an
//! overlay the host renders — the daemon just places (or removes) the file.
//!
//! Enabled by the `boot_movie` config flag. On every boot the daemon calls
//! `apply()`: when on, place the configured source WebM into
//! `<steam>/config/uioverrides/movies/` under each startup-movie name the
//! platform might play (see `slot_names`); when off, remove them. Steam picks a
//! different name per device (LCD Deck / OLED Deck / desktop Big Picture), so
//! writing every applicable name is what makes the override actually take effect.
//! Each slot is a symlink to the source (the same approach animation-manager
//! plugins use), falling back to a copy where symlinks aren't available. The
//! install/remove core is pure (`install_one`/`remove_one`) so it unit-tests
//! against a temp dir without a real Steam install.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

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

/// Remove every slot name this host may have installed. Missing names succeed.
pub fn remove_from(movies_dir: &Path) -> Result<(), String> {
    for name in slot_names() {
        remove_one(movies_dir, name)?;
    }
    Ok(())
}

/// Apply the `boot_movie` preference. `Ok(Some(path))` = installed there,
/// `Ok(None)` = removed / not installed. Best-effort: a resolvable-dir failure
/// is an error the caller logs, never a fatal daemon condition.
pub fn apply(enabled: bool, source: &Path) -> Result<Option<PathBuf>, String> {
    let dir =
        movies_dir().ok_or_else(|| "cannot resolve Steam movies dir (no HOME)".to_string())?;
    if enabled {
        install_to(&dir, source).map(Some)
    } else {
        remove_from(&dir).map(|()| None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let mut p = env::temp_dir();
        p.push(format!(
            "shelveshub-boot-test-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        p
    }

    #[test]
    fn install_places_source_under_the_given_name() {
        let root = tmp();
        let movies = root.join("movies");
        let src = root.join("src.webm");
        fs::create_dir_all(&root).unwrap();
        fs::write(&src, b"WEBMDATA").unwrap();

        let dest = install_one(&movies, &src, "deck_startup.webm").unwrap();
        assert_eq!(dest.file_name().unwrap(), "deck_startup.webm");
        // Whether linked (Unix) or copied, the slot reads back as the source.
        assert!(dest.exists());
        assert_eq!(fs::read(&dest).unwrap(), b"WEBMDATA");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn install_to_fills_every_platform_slot() {
        // `install_to` writes the movie under each name Steam might play, and
        // `remove_from` clears them all again.
        let root = tmp();
        let movies = root.join("movies");
        let src = root.join("src.webm");
        fs::create_dir_all(&root).unwrap();
        fs::write(&src, b"WEBMDATA").unwrap();

        install_to(&movies, &src).unwrap();
        for name in slot_names() {
            assert!(movies.join(name).exists(), "missing slot {name}");
            assert_eq!(fs::read(movies.join(name)).unwrap(), b"WEBMDATA");
        }
        remove_from(&movies).unwrap();
        for name in slot_names() {
            assert!(!movies.join(name).exists(), "slot {name} not removed");
        }
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn install_errors_when_source_missing() {
        let root = tmp();
        let err = install_to(&root.join("movies"), &root.join("nope.webm")).unwrap_err();
        assert!(err.contains("source missing"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn install_replaces_an_existing_symlink_to_a_foreign_target() {
        // Steam's default (or another tool) may leave a symlink in the slot.
        // Installing must repoint it at OUR source, never write through the old
        // link onto its foreign target.
        let root = tmp();
        let movies = root.join("movies");
        let src = root.join("src.webm");
        let foreign = root.join("foreign.webm");
        fs::create_dir_all(&movies).unwrap();
        fs::write(&src, b"OURS").unwrap();
        fs::write(&foreign, b"THEIRS").unwrap();
        std::os::unix::fs::symlink(&foreign, movies.join("deck_startup.webm")).unwrap();

        let dest = install_one(&movies, &src, "deck_startup.webm").unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"OURS");
        // The old link's former target is untouched.
        assert_eq!(fs::read(&foreign).unwrap(), b"THEIRS");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn remove_is_idempotent() {
        let root = tmp();
        let movies = root.join("movies");
        let src = root.join("src.webm");
        fs::create_dir_all(&root).unwrap();
        fs::write(&src, b"X").unwrap();

        install_to(&movies, &src).unwrap();
        remove_from(&movies).unwrap();
        for name in slot_names() {
            assert!(!movies.join(name).exists());
        }
        // Removing again is still Ok (missing = success).
        remove_from(&movies).unwrap();
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn movies_dir_resolves_under_home() {
        // With HOME set, a directory is always resolvable (created or existing).
        let dir = movies_dir();
        assert!(dir.is_some());
        assert!(dir.unwrap().ends_with("uioverrides/movies") || cfg!(windows));
    }
}
