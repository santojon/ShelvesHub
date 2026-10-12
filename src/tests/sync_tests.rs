// Unit tests for the `sync` module, extracted from sync.rs and attached
// via `#[cfg(test)] #[path = "tests/sync_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

use super::*;

fn entry(value: bool, at: u64) -> Entry {
    Entry {
        value: Value::Bool(value),
        at,
    }
}

fn entries(items: &[(&str, bool, u64)]) -> BTreeMap<String, Entry> {
    items
        .iter()
        .map(|(k, v, at)| (k.to_string(), entry(*v, *at)))
        .collect()
}

fn values(items: &[(&str, bool)]) -> BTreeMap<String, Value> {
    items
        .iter()
        .map(|(k, v)| (k.to_string(), Value::Bool(*v)))
        .collect()
}

#[test]
fn merge_newest_stamp_wins_each_way() {
    let local = entries(&[("auto_update", true, 10), ("quiet_updates", false, 50)]);
    let cloud = entries(&[("auto_update", false, 20), ("quiet_updates", true, 40)]);
    let m = merge(&local, &cloud);
    // The cloud is newer for auto_update → taken over; local is newer for
    // quiet_updates → the document changes and must be written.
    assert_eq!(
        m.adopt,
        vec![("auto_update".to_string(), Value::Bool(false))]
    );
    assert!(m.push);
    assert_eq!(m.entries["quiet_updates"], entry(false, 50));
    assert_eq!(m.entries["auto_update"], entry(false, 20));
}

#[test]
fn merge_tie_keeps_equal_values_and_takes_the_shared_copy_when_they_differ() {
    let local = entries(&[("auto_update", true, 0), ("quiet_updates", true, 7)]);
    let cloud = entries(&[("auto_update", false, 0), ("quiet_updates", true, 7)]);
    let m = merge(&local, &cloud);
    assert_eq!(
        m.adopt,
        vec![("auto_update".to_string(), Value::Bool(false))]
    );
    assert!(!m.push, "nothing of ours is newer — no write");
}

#[test]
fn merge_pushes_missing_local_keys_and_keeps_unknown_cloud_keys() {
    let local = entries(&[("auto_update", true, 0)]);
    let cloud = entries(&[("future_key", true, 99)]);
    let m = merge(&local, &cloud);
    assert!(m.adopt.is_empty());
    assert!(m.push);
    assert_eq!(m.entries.len(), 2);
    assert_eq!(m.entries["future_key"], entry(true, 99));
    assert_eq!(m.entries["auto_update"], entry(true, 0));
}

#[test]
fn merge_converges_after_one_exchange() {
    // Device A changed auto_update at 30 and pushed; device B still has at 10.
    let a = entries(&[("auto_update", true, 30)]);
    let cloud = merge(&a, &BTreeMap::new()).entries;
    let b = entries(&[("auto_update", false, 10)]);
    let first = merge(&b, &cloud);
    assert_eq!(
        first.adopt,
        vec![("auto_update".to_string(), Value::Bool(true))]
    );
    // B applied it and carries the cloud stamp now: the next round is quiet.
    let b_after = entries(&[("auto_update", true, 30)]);
    let second = merge(&b_after, &first.entries);
    assert!(second.adopt.is_empty());
    assert!(!second.push);
}

#[test]
fn stamp_marks_changes_since_the_last_round() {
    let local = values(&[("auto_update", true), ("quiet_updates", true)]);
    let base: Map<String, Value> = [
        ("auto_update".to_string(), Value::Bool(false)),
        ("quiet_updates".to_string(), Value::Bool(true)),
    ]
    .into_iter()
    .collect();
    let stamps: BTreeMap<String, u64> = [("quiet_updates".to_string(), 5)].into_iter().collect();
    let out = stamp(&local, &base, &stamps, &defaults(), 100);
    assert_eq!(out["auto_update"].at, 100, "changed since the last round");
    assert_eq!(out["quiet_updates"].at, 5, "unchanged keeps its stamp");
}

#[test]
fn stamp_on_a_first_round_marks_only_non_defaults() {
    let local = values(&[("auto_update", true), ("quiet_updates", true)]);
    let out = stamp(&local, &Map::new(), &BTreeMap::new(), &defaults(), 100);
    assert_eq!(
        out["auto_update"].at, 100,
        "not the default → the user set it here"
    );
    assert_eq!(
        out["quiet_updates"].at, 0,
        "a default has never been changed"
    );
}

#[test]
fn doc_parse_rejects_junk_and_keeps_extra_fields() {
    assert!(Doc::parse("").is_none());
    assert!(Doc::parse("{ not json").is_none());
    assert!(Doc::parse(r#"{"entries":{}}"#).is_none(), "unversioned");
    let doc = Doc::parse(
        r#"{"v":1,"updated_at":5,"from":"deck/x86_64","entries":{"auto_update":{"value":true,"at":5}},"later":{"x":1}}"#,
    )
    .unwrap();
    assert_eq!(doc.entries["auto_update"], entry(true, 5));
    assert_eq!(doc.extra["later"]["x"], 1);
    let text = serde_json::to_string(&doc).unwrap();
    assert!(text.contains("\"later\""), "{text}");
}

#[test]
fn apply_writes_only_booleans_for_known_keys() {
    let mut settings = HubSettings::default();
    let mut file = Map::new();
    let adopt = vec![
        ("auto_update".to_string(), Value::Bool(true)),
        ("quiet_updates".to_string(), Value::String("yes".into())),
        ("recover_cmd".to_string(), Value::String("rm -rf /".into())),
        ("interval_secs".to_string(), Value::Bool(true)),
        ("native_notifications".to_string(), Value::Bool(false)),
    ];
    let (applied, restart) = apply(&adopt, &mut settings, &mut file);
    assert!(settings.auto_update);
    assert!(settings.quiet_updates, "a non-boolean is ignored");
    assert_eq!(
        file.len(),
        1,
        "only synced config keys reach the file: {file:?}"
    );
    assert_eq!(file["native_notifications"], Value::Bool(false));
    assert_eq!(applied, vec!["auto_update", "native_notifications"]);
    assert!(restart, "native_notifications is read at start-up");
}

#[test]
fn local_values_cover_the_store_keys_and_config_file_values() {
    let settings = HubSettings {
        hub_prerelease: true,
        ..Default::default()
    };
    let mut file = Map::new();
    file.insert("native_notifications".to_string(), Value::Bool(false));
    file.insert("recover_cmd".to_string(), Value::String("x".into()));
    let local = local_values(&settings, &file);
    assert_eq!(local["hub_prerelease"], Value::Bool(true));
    assert_eq!(local["native_notifications"], Value::Bool(false));
    assert!(!local.contains_key("recover_cmd"));
    for key in STORE_KEYS {
        assert!(local.contains_key(key), "{key}");
    }
}
