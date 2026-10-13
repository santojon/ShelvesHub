// Unit tests for the `bootmovie` module, extracted from bootmovie.rs and attached
// via `#[cfg(test)] #[path = "tests/bootmovie_tests.rs"] mod tests;` — `super::*`
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

/// A scratch root with the movies dir, a source movie and a store path.
fn fixture() -> (PathBuf, PathBuf, PathBuf, PathBuf) {
    let root = tmp();
    let movies = root.join("movies");
    let src = root.join("src.webm");
    let store = root.join("shelveshub.json");
    fs::create_dir_all(&movies).unwrap();
    fs::write(&src, b"WEBMDATA").unwrap();
    (root, movies, src, store)
}

fn recorded(store: &Path) -> Vec<String> {
    crate::store::load(store).boot_movie_slots
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
    // `remove_ours` clears them all again (they hold our movie).
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
    remove_ours(&movies, &[], &src).unwrap();
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
    remove_ours(&movies, &[], &src).unwrap();
    for name in slot_names() {
        assert!(!movies.join(name).exists());
    }
    // Removing again is still Ok (missing = success).
    remove_ours(&movies, &[], &src).unwrap();
    fs::remove_dir_all(&root).ok();
}

#[test]
fn removal_leaves_another_tools_files_alone() {
    let (root, movies, src, _) = fixture();
    let first = slot_names()[0];
    // Another animation tool's copy sits in a slot name; a second slot is ours.
    fs::write(movies.join(first), b"SOMEONE ELSES MOVIE").unwrap();
    let last = slot_names()[slot_names().len() - 1];
    if last != first {
        install_one(&movies, &src, last).unwrap();
    }

    remove_ours(&movies, &[], &src).unwrap();
    assert_eq!(
        fs::read(movies.join(first)).unwrap(),
        b"SOMEONE ELSES MOVIE"
    );
    if last != first {
        assert!(!movies.join(last).exists(), "our slot is removed");
    }
    // A recorded name is removed even when its content is no longer readable as ours.
    remove_ours(&movies, &[first.to_string()], &src).unwrap();
    assert!(!movies.join(first).exists());
    fs::remove_dir_all(&root).ok();
}

#[test]
fn apply_records_the_placed_slots_and_off_clears_only_those() {
    let (root, movies, src, store) = fixture();
    let placed = apply_in(&movies, true, &src, &store).unwrap();
    assert!(placed.is_some());
    let names: Vec<String> = slot_names().iter().map(|n| n.to_string()).collect();
    assert_eq!(recorded(&store), names, "every placed slot is recorded");

    // A foreign file put into a slot after ours was placed there is not ours to
    // remove once the record no longer names it; one placed under an unrecorded
    // name but holding our movie (from before the record existed) is.
    let foreign_name = slot_names()[0];
    fs::remove_file(movies.join(foreign_name)).unwrap();
    fs::write(movies.join(foreign_name), b"SOMEONE ELSES MOVIE").unwrap();
    let without_first: Vec<String> = names.iter().skip(1).cloned().collect();
    crate::store::update(&store, |s| s.boot_movie_slots = without_first).unwrap();

    assert_eq!(apply_in(&movies, false, &src, &store).unwrap(), None);
    assert_eq!(
        fs::read(movies.join(foreign_name)).unwrap(),
        b"SOMEONE ELSES MOVIE"
    );
    for name in slot_names().iter().skip(1) {
        assert!(!movies.join(name).exists(), "{name} should be gone");
    }
    assert!(recorded(&store).is_empty(), "the record is cleared");
    fs::remove_dir_all(&root).ok();
}

#[test]
fn apply_off_removes_an_unrecorded_slot_that_holds_our_movie() {
    // Installed by a build from before the record existed: the slot holds our
    // bytes but no record names it. It is still removed; a foreign one is not.
    let (root, movies, src, store) = fixture();
    install_to(&movies, &src).unwrap();
    assert!(recorded(&store).is_empty());

    assert_eq!(apply_in(&movies, false, &src, &store).unwrap(), None);
    for name in slot_names() {
        assert!(!movies.join(name).exists(), "{name} should be gone");
    }
    // With nothing of ours in place, a boot with the movie off writes no store.
    assert!(!store.exists(), "no record to clear, no store written");
    fs::remove_dir_all(&root).ok();
}

#[test]
fn movies_dir_resolves_under_home() {
    // With HOME set, a directory is always resolvable (created or existing).
    let dir = movies_dir();
    assert!(dir.is_some());
    assert!(dir.unwrap().ends_with("uioverrides/movies") || cfg!(windows));
}
