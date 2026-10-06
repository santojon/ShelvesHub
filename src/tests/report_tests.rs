use super::*;

#[test]
fn arch_matches_normalises_families() {
    assert!(arch_matches("aarch64", "arm64"));
    assert!(arch_matches("x86_64", "amd64"));
    assert!(arch_matches("aarch64", "aarch64"));
    assert!(!arch_matches("x86_64", "aarch64"));
}

#[test]
fn status_report_has_the_expected_shape() {
    let v = status_report();
    let sh = &v["shelveshub"];
    assert_eq!(sh["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(sh["os"], std::env::consts::OS);
    assert_eq!(sh["targetArch"], std::env::consts::ARCH);
    // `runtime` is always present; `native` is a bool or null (uname may be absent).
    assert!(v.get("runtime").is_some());
    assert!(sh.get("native").is_some());
}

// Device detection reads sysfs/procfs under a root; a temp fixture mimics a DSI-panel
// ARM board (a Steam Frame-like device-tree) so the probe is testable without QEMU.
#[cfg(target_os = "linux")]
#[test]
fn device_block_reads_sysfs_fixtures() {
    use std::fs;
    let root =
        std::env::temp_dir().join(format!("shelveshub-report-fixture-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("proc/device-tree")).unwrap();
    fs::create_dir_all(root.join("sys/class/drm/card0-DSI-1")).unwrap();
    fs::create_dir_all(root.join("sys/class/drm/card0-HDMI-A-1")).unwrap();
    fs::write(root.join("proc/device-tree/model"), b"Valve Steam Frame\0").unwrap();
    fs::write(
        root.join("proc/cpuinfo"),
        b"processor\t: 0\nHardware\t: Qualcomm\n",
    )
    .unwrap();
    fs::write(
        root.join("sys/class/drm/card0-DSI-1/status"),
        b"connected\n",
    )
    .unwrap();
    fs::write(
        root.join("sys/class/drm/card0-HDMI-A-1/status"),
        b"disconnected\n",
    )
    .unwrap();

    let v = device_block_at(&root);
    assert_eq!(v["deviceTreeModel"], "Valve Steam Frame");
    assert_eq!(v["cpu"], "Qualcomm");
    let conns = v["drmConnectors"].as_array().unwrap();
    assert_eq!(conns.len(), 2);
    assert_eq!(conns[0]["connector"], "card0-DSI-1"); // sorted
    assert_eq!(conns[0]["status"], "connected");
    let _ = fs::remove_dir_all(&root);
}
