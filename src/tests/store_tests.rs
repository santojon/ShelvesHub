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
fn atomic_write_leaves_no_temp() {
    let path = scratch("atomic");
    cleanup(&path);
    save(&path, &HubSettings::default()).unwrap();
    let tmp = path.with_file_name(".shelveshub.json.tmp");
    assert!(!tmp.exists(), "temp file should be renamed away");
    cleanup(&path);
}
