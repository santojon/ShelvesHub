// Unit tests for the `config` module, extracted from config.rs and attached
// via `#[cfg(test)] #[path = "tests/config_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

use super::*;

#[test]
fn config_file_overrides_default() {
    // A key not present in the environment, so the file value is used.
    const UNSET: &str = "SHELVES_UNSET_TEST_KEY_XYZ";
    let file = serde_json::json!({
        "rpc_host": "0.0.0.0",
        "rpc_port": 60124,
        "owner_settle_secs": 25,
        "native_qam": true
    });
    assert_eq!(cfg_string(&file, UNSET, "rpc_host", "127.0.0.1"), "0.0.0.0");
    assert_eq!(cfg_u16(&file, UNSET, "rpc_port", 60123), 60124);
    assert_eq!(cfg_u64(&file, UNSET, "owner_settle_secs", 0), 25);
    assert!(cfg_bool(&file, UNSET, "native_qam"));
    // Missing key → built-in default.
    assert_eq!(cfg_u16(&file, UNSET, "absent", 8080), 8080);
    assert!(!cfg_bool(&file, UNSET, "absent"));
    // Empty / null file → default.
    assert_eq!(cfg_u16(&Value::Null, UNSET, "rpc_port", 60123), 60123);
}

#[test]
fn recover_cmd_resolution() {
    // "off" (any case, trimmed) disables auto-recovery → pause only.
    assert_eq!(resolve_recover_cmd(Some("off".to_string())), None);
    assert_eq!(resolve_recover_cmd(Some("OFF".to_string())), None);
    assert_eq!(resolve_recover_cmd(Some("  Off ".to_string())), None);
    // A custom command passes through (trimmed).
    assert_eq!(
        resolve_recover_cmd(Some("  my-recover ".to_string())),
        Some("my-recover".to_string())
    );
    // Empty or absent → the per-platform official default (non-None on all targets).
    assert_eq!(
        resolve_recover_cmd(Some(String::new())),
        default_recover_cmd()
    );
    assert_eq!(resolve_recover_cmd(None), default_recover_cmd());
    // macOS/Windows (always sole hosts) always have a default; on Linux the default is
    // runtime-detected (the steam-launcher unit may be absent → None, pause only).
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    assert!(resolve_recover_cmd(None).is_some());
}

#[test]
fn config_file_write_is_atomic_keeps_comments_and_rolls_a_backup() {
    let dir = std::env::temp_dir().join(format!("shelveshub-cfgwrite-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("shelveshub.config.json");
    // The shipped file carries its comments as "// key" string entries.
    let mut obj = serde_json::Map::new();
    obj.insert("//".to_string(), Value::String("header".into()));
    obj.insert("// rpc_port".to_string(), Value::String("port note".into()));
    obj.insert("rpc_port".to_string(), Value::from(60123));
    write_config_object(&path, &obj).unwrap();
    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
    assert!(!dir.join("shelveshub.config.json.bak").exists());

    // Read-merge-write keeps every comment entry; the first good copy rolls to .bak.
    let mut again = read_config_object(&path);
    assert_eq!(
        again.get("// rpc_port").and_then(Value::as_str),
        Some("port note")
    );
    again.insert("rpc_port".to_string(), Value::from(60124));
    write_config_object(&path, &again).unwrap();
    let now = read_config_object(&path);
    assert_eq!(now.get("rpc_port").and_then(Value::as_u64), Some(60124));
    assert_eq!(now.get("//").and_then(Value::as_str), Some("header"));
    assert_eq!(
        now.get("// rpc_port").and_then(Value::as_str),
        Some("port note")
    );
    let bak = read_config_object(&dir.join("shelveshub.config.json.bak"));
    assert_eq!(bak.get("rpc_port").and_then(Value::as_u64), Some(60123));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn config_file_keeps_its_key_order_and_edits_merge_under_the_lock() {
    let dir = std::env::temp_dir().join(format!("shelveshub-cfgorder-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("shelveshub.config.json");
    // The shipped file is hand-ordered, each "// key" note right above its key.
    let keys = [
        "//",
        "rpc_port",
        "// native_qam",
        "native_qam",
        "cef_port",
        "// z",
        "boot_movie",
    ];
    let mut obj = serde_json::Map::new();
    for (i, k) in keys.iter().enumerate() {
        obj.insert(k.to_string(), Value::from(i as u64));
    }
    write_config_object(&path, &obj).unwrap();
    let order = |m: &serde_json::Map<String, Value>| m.keys().cloned().collect::<Vec<_>>();
    assert_eq!(order(&read_config_object(&path)), keys);
    // An edited key keeps its slot; a new key goes last; unchanged = no write.
    update_config_object(&path, |o| {
        o.insert("native_qam".to_string(), Value::Bool(true));
        o.insert("added".to_string(), Value::Bool(false));
    })
    .unwrap();
    let now = read_config_object(&path);
    let mut expected: Vec<String> = keys.iter().map(|k| k.to_string()).collect();
    expected.push("added".to_string());
    assert_eq!(order(&now), expected);
    assert_eq!(now["native_qam"], Value::Bool(true));
    let stamp = std::fs::metadata(&path).unwrap().modified().unwrap();
    update_config_object(&path, |_| {}).unwrap();
    assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), stamp);
    // Concurrent editors of different keys never revert each other.
    let threads: Vec<_> = (0..6)
        .map(|i| {
            let path = path.clone();
            std::thread::spawn(move || {
                update_config_object(&path, |o| {
                    o.insert(format!("k{i}"), Value::from(i));
                })
                .unwrap();
            })
        })
        .collect();
    for t in threads {
        t.join().unwrap();
    }
    let merged = read_config_object(&path);
    for i in 0..6u64 {
        assert_eq!(merged[&format!("k{i}")], Value::from(i), "{merged:?}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rpc_addr_parses_host_port_and_falls_back_to_the_file() {
    assert_eq!(
        split_host_port("127.0.0.1:60123"),
        Some(("127.0.0.1".to_string(), 60123))
    );
    assert_eq!(split_host_port(" [::1]:7 "), Some(("[::1]".to_string(), 7)));
    assert_eq!(split_host_port("60123"), None);
    assert_eq!(split_host_port(":60123"), None);
    assert_eq!(split_host_port("host:port"), None);
    // No env override: the file, then the default.
    let file = serde_json::json!({ "rpc_host": "0.0.0.0", "rpc_port": 60124 });
    assert_eq!(
        resolve_rpc_addr_with(None, None, None, &file),
        "0.0.0.0:60124"
    );
    assert_eq!(
        resolve_rpc_addr_with(None, None, None, &Value::Null),
        format!("{DEFAULT_RPC_HOST}:{DEFAULT_RPC_PORT}")
    );
    // SHELVES_RPC_ADDR is honoured (over the file); HOST/PORT win over it per part.
    assert_eq!(
        resolve_rpc_addr_with(None, None, Some("[::1]:7".into()), &file),
        "[::1]:7"
    );
    assert_eq!(
        resolve_rpc_addr_with(
            Some("0.0.0.0".into()),
            None,
            Some("127.0.0.1:9".into()),
            &file
        ),
        "0.0.0.0:9"
    );
    // An unparseable port falls through to the next source.
    assert_eq!(
        resolve_rpc_addr_with(
            None,
            Some("abc".into()),
            Some("127.0.0.1:9".into()),
            &Value::Null
        ),
        "127.0.0.1:9"
    );
    assert_eq!(
        resolve_rpc_addr_with(None, None, Some("nonsense".into()), &file),
        "0.0.0.0:60124"
    );
}

#[test]
fn cef_port_candidates_start_with_the_configured_port_without_duplicates() {
    assert_eq!(cef_port_candidates(8080), vec![8080, 8081]);
    assert_eq!(cef_port_candidates(8081), vec![8081, 8080]);
    assert_eq!(cef_port_candidates(9222), vec![9222, 8080, 8081]);
}

#[test]
fn hub_config_path_from_env_matches_the_resolved_config() {
    assert_eq!(
        hub_config_path_from_env(),
        Config::from_env().hub_config_path
    );
    assert!(
        hub_config_path_from_env().ends_with("shelveshub.json")
            || env::var_os("SHELVES_HUB_CONFIG").is_some()
    );
}

#[test]
fn detected_device_is_detected_once_and_well_formed() {
    let first = detected_device();
    assert!(first.get("kind").and_then(Value::as_str).is_some());
    assert_eq!(first["arch"], std::env::consts::ARCH);
    assert_eq!(detected_device(), first);
}

// The Linux recovery default is runtime-detected — present ⇒ restart the
// session service, absent ⇒ None (pause only). Deterministic on any Linux (CI has
// no steam-launcher ⇒ None; a Deck has it ⇒ Some).
#[cfg(target_os = "linux")]
#[test]
fn linux_recovery_matches_steam_launcher_presence() {
    assert_eq!(default_recover_cmd().is_some(), steam_launcher_present());
}
