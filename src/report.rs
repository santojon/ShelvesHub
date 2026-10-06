//! `shelveshub status [--report]`: a one-shot JSON diagnostics report a tester can
//! file — the terminal-side mirror of the plugin's "Hardware report" — so an ARM64 /
//! Frame / Machine environment can be characterised without opening the UI in a
//! headset. All probes are best-effort; a missing tool/path is reported as null.

use std::process::Command;

use serde_json::{json, Value};

/// Run `cmd args...` and return trimmed stdout, or None on any failure/empty output.
fn cmd_out(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn first_line(s: &str) -> String {
    s.lines().next().unwrap_or("").trim().to_string()
}

/// True when the compile target arch and the kernel's reported arch are the same
/// family (so an x86_64 binary under translation on aarch64 reads as non-native).
fn norm_arch(s: &str) -> &str {
    match s {
        "arm64" => "aarch64",
        "amd64" => "x86_64",
        other => other,
    }
}

fn arch_matches(target: &str, runtime: &str) -> bool {
    norm_arch(target) == norm_arch(runtime)
}

#[cfg(target_os = "linux")]
fn read_trimmed(path: &str) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|s| {
            s.trim_matches(|c: char| c == '\0' || c.is_whitespace())
                .to_string()
        })
        .filter(|s| !s.is_empty())
}

#[cfg(target_os = "linux")]
fn drm_connectors(root: &std::path::Path) -> Vec<Value> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(root.join("sys/class/drm")) else {
        return out;
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !name.contains('-') {
            continue; // skip cardN / renderDN; keep cardN-<connector>
        }
        let status = read_trimmed(
            &root
                .join(format!("sys/class/drm/{name}/status"))
                .to_string_lossy(),
        )
        .unwrap_or_default();
        out.push(json!({ "connector": name, "status": status }));
    }
    out.sort_by(|a, b| a["connector"].as_str().cmp(&b["connector"].as_str()));
    out
}

/// Linux device identity read under `root` (normally "/"; a temp dir in tests): the
/// device-tree model (ARM boards), DMI product (x86), the cpuinfo model/hardware line,
/// the DRM connector list, and whether the SteamOS session service is present.
#[cfg(target_os = "linux")]
fn device_block_at(root: &std::path::Path) -> Value {
    let cpuinfo = std::fs::read_to_string(root.join("proc/cpuinfo")).unwrap_or_default();
    let cpu = cpuinfo
        .lines()
        .find(|l| l.starts_with("model name") || l.starts_with("Hardware"))
        .and_then(|l| l.split_once(':').map(|(_, v)| v.trim().to_string()));
    json!({
        "deviceTreeModel": read_trimmed(&root.join("proc/device-tree/model").to_string_lossy()),
        "dmiProduct": read_trimmed(&root.join("sys/class/dmi/id/product_name").to_string_lossy()),
        "cpu": cpu,
        "drmConnectors": drm_connectors(root),
        "steamLauncherService": cmd_out("systemctl", &["--user", "cat", "steam-launcher.service"]).is_some(),
    })
}

#[cfg(target_os = "linux")]
fn device_block() -> Value {
    device_block_at(std::path::Path::new("/"))
}

#[cfg(not(target_os = "linux"))]
fn device_block() -> Value {
    Value::Null
}

/// The full report value.
pub fn status_report() -> Value {
    let target_arch = std::env::consts::ARCH;
    let runtime_arch = cmd_out("uname", &["-m"]);
    let native = runtime_arch
        .as_deref()
        .map(|r| arch_matches(target_arch, r));
    let glibc = if cfg!(target_os = "linux") {
        cmd_out("ldd", &["--version"]).map(|s| first_line(&s))
    } else {
        None
    };
    json!({
        "shelveshub": {
            "version": env!("CARGO_PKG_VERSION"),
            "hostApiVersion": crate::HOST_API_VERSION,
            "os": std::env::consts::OS,
            "targetArch": target_arch,
            "runtimeArch": runtime_arch,
            "native": native,
        },
        "runtime": {
            "glibc": glibc,
            "python": cmd_out("python3", &["--version"]).map(|s| first_line(&s)),
        },
        "device": device_block(),
    })
}

/// Print the report as pretty JSON to stdout (the `status` subcommand).
pub fn print_status_report() {
    let v = status_report();
    println!(
        "{}",
        serde_json::to_string_pretty(&v).unwrap_or_else(|_| v.to_string())
    );
}

#[cfg(test)]
#[path = "tests/report_tests.rs"]
mod tests;
