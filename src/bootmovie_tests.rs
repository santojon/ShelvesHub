// Unit tests for the `bootmovie` module, extracted from bootmovie.rs and attached
// via `#[cfg(test)] #[path = "bootmovie_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

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
