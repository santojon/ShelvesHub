// Unit tests for the `store` module, extracted from store.rs and attached
// via `#[cfg(test)] #[path = "tests/store_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

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
    let s = HubSettings {
        auto_update: true,
        ..Default::default()
    };
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
fn preserves_unknown_keys_from_a_newer_daemon() {
    let path = scratch("unknown");
    cleanup(&path);
    // A newer ShelvesHub wrote a field this build doesn't know about.
    fs::write(
        &path,
        r#"{"auto_update":true,"future_setting":{"nested":42},"another":"x"}"#,
    )
    .unwrap();

    let loaded = load(&path);
    assert!(loaded.auto_update); // known field still parses
    assert_eq!(loaded.extra.get("future_setting").unwrap()["nested"], 42);
    assert_eq!(loaded.extra.get("another").unwrap(), "x");

    // Re-saving must NOT drop the unknown keys.
    save(&path, &loaded).unwrap();
    let text = fs::read_to_string(&path).unwrap();
    assert!(text.contains("future_setting"), "{text}");
    assert!(text.contains("\"another\""), "{text}");
    assert_eq!(load(&path).extra.get("another").unwrap(), "x");
    cleanup(&path);
}

#[test]
fn corrupt_primary_heals_from_backup() {
    let path = scratch("corrupt");
    cleanup(&path);
    // First save establishes the file; second save rolls the first to .bak.
    save(
        &path,
        &HubSettings {
            auto_update: true,
            ..Default::default()
        },
    )
    .unwrap();
    save(
        &path,
        &HubSettings {
            auto_update: false,
            ..Default::default()
        },
    )
    .unwrap();
    // Corrupt the primary — the backup still holds the first (auto_update:true).
    fs::write(&path, "{ not valid json").unwrap();
    assert_eq!(
        load(&path),
        HubSettings {
            auto_update: true,
            ..Default::default()
        }
    );
    // …and the heal rewrote a valid primary.
    assert_eq!(
        read_valid(&path),
        Some(HubSettings {
            auto_update: true,
            ..Default::default()
        })
    );
    cleanup(&path);
}

#[test]
fn quiet_updates_default_on_and_rollback_fields_roundtrip() {
    let path = scratch("rollback");
    cleanup(&path);
    assert!(HubSettings::default().quiet_updates);
    let s = HubSettings {
        bundle_tag: "v3.4.0".into(),
        bundle_prev_tag: "v3.3.4".into(),
        bundle_hold_tag: "v3.4.0".into(),
        hub_hold_tag: "0.6.0".into(),
        quiet_updates: false,
        last_run_version: "0.5.0".into(),
        ..Default::default()
    };
    save(&path, &s).unwrap();
    assert_eq!(load(&path), s);
    // A file from before these fields existed loads with their defaults.
    fs::write(&path, r#"{"auto_update":true}"#).unwrap();
    let old = load(&path);
    assert!(old.quiet_updates);
    assert!(old.last_run_version.is_empty());
    assert!(old.bundle_prev_tag.is_empty());
    assert!(old.bundle_hold_tag.is_empty());
    assert!(old.hub_hold_tag.is_empty());
    cleanup(&path);
}

#[test]
fn settings_sync_defaults_on_and_bookkeeping_roundtrips() {
    let path = scratch("sync");
    cleanup(&path);
    let d = HubSettings::default();
    assert!(d.config_sync);
    assert_eq!(d.sync_last_at, 0);
    let s = HubSettings {
        config_sync: false,
        sync_base: [("auto_update".to_string(), serde_json::Value::Bool(true))]
            .into_iter()
            .collect(),
        sync_stamps: [("auto_update".to_string(), 42u64)].into_iter().collect(),
        sync_last_at: 1_700_000_000_000,
        ..Default::default()
    };
    save(&path, &s).unwrap();
    assert_eq!(load(&path), s);
    // A file from before sync existed loads with sync on and nothing recorded.
    fs::write(&path, r#"{"auto_update":true}"#).unwrap();
    let old = load(&path);
    assert!(old.config_sync);
    assert!(old.sync_base.is_empty());
    assert!(old.sync_stamps.is_empty());
    cleanup(&path);
}

#[test]
fn wrong_type_known_key_keeps_the_other_settings() {
    let path = scratch("lenient");
    cleanup(&path);
    // Two mistyped known keys fall back to their defaults; the rest is kept.
    fs::write(
        &path,
        r#"{"auto_update":true,"quiet_updates":"yes","bundle_tag":42,"config_sync":false,"keep":1}"#,
    )
    .unwrap();
    let s = load(&path);
    assert!(s.auto_update);
    assert!(!s.config_sync);
    assert!(s.quiet_updates, "mistyped key falls back to its default");
    assert!(s.bundle_tag.is_empty());
    assert_eq!(
        s.extra.get("keep").and_then(serde_json::Value::as_u64),
        Some(1)
    );
    assert!(s.extra.get("quiet_updates").is_none());
    // A bad inner shape (a stamp that is not a number) drops only that key.
    fs::write(
        &path,
        r#"{"auto_update":true,"sync_stamps":{"auto_update":"x"},"sync_last_at":5}"#,
    )
    .unwrap();
    let s = load(&path);
    assert!(s.auto_update);
    assert!(s.sync_stamps.is_empty());
    assert_eq!(s.sync_last_at, 5);
    // Not JSON at all is still corrupt → defaults.
    fs::write(&path, "{ not valid json").unwrap();
    assert_eq!(load(&path), HubSettings::default());
    cleanup(&path);
}

/// Temp files left in the store's directory (`.<name>.<pid>.<n>.tmp`).
fn temp_files(path: &Path) -> Vec<String> {
    let dir = path.parent().unwrap();
    fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".tmp"))
        .collect()
}

#[test]
fn atomic_write_leaves_no_temp() {
    let path = scratch("atomic");
    cleanup(&path);
    save(&path, &HubSettings::default()).unwrap();
    save(&path, &HubSettings::default()).unwrap();
    assert!(
        temp_files(&path).is_empty(),
        "temp files should be renamed away: {:?}",
        temp_files(&path)
    );
    cleanup(&path);
}

#[test]
fn update_serializes_concurrent_writers_and_skips_an_unchanged_save() {
    let path = scratch("update");
    cleanup(&path);
    // Many threads bump the same counter through load→modify→save: with the
    // store lock every increment lands; without it most would be lost.
    let threads: Vec<_> = (0..8)
        .map(|_| {
            let path = path.clone();
            std::thread::spawn(move || {
                for _ in 0..10 {
                    update(&path, |s| s.sync_last_at += 1).unwrap();
                }
            })
        })
        .collect();
    for t in threads {
        t.join().unwrap();
    }
    assert_eq!(load(&path).sync_last_at, 80);
    assert!(temp_files(&path).is_empty(), "{:?}", temp_files(&path));
    // The saved settings come back; a closure that changes nothing writes nothing.
    let stamp = fs::metadata(&path).unwrap().modified().unwrap();
    let bak_before = fs::read_to_string(backup_path(&path)).unwrap();
    let same = update(&path, |_| {}).unwrap();
    assert_eq!(same.sync_last_at, 80);
    assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), stamp);
    assert_eq!(fs::read_to_string(backup_path(&path)).unwrap(), bak_before);
    cleanup(&path);
}

#[test]
fn auto_update_defaults_on_and_boot_movie_slots_roundtrip() {
    let path = scratch("slots");
    cleanup(&path);
    let d = HubSettings::default();
    assert!(
        d.auto_update,
        "updates are on out of the box, like the installers promise"
    );
    assert!(d.auto_update_hub && d.auto_update_plugin);
    assert!(d.boot_movie_slots.is_empty());
    let s = HubSettings {
        boot_movie_slots: vec!["deck_startup.webm".into(), "oled_startup.webm".into()],
        ..Default::default()
    };
    save(&path, &s).unwrap();
    assert_eq!(load(&path), s);
    // A file from before the record existed loads with no slots recorded.
    fs::write(&path, r#"{"auto_update":false}"#).unwrap();
    let old = load(&path);
    assert!(!old.auto_update);
    assert!(old.boot_movie_slots.is_empty());
    cleanup(&path);
}
