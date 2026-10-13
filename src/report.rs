//! `shelveshub status [--report]`: a one-shot JSON diagnostics report a tester can
//! file — the terminal-side mirror of the plugin's "Hardware report" — so an ARM64 /
//! Frame / Machine environment can be characterised without opening the UI in a
//! headset. All probes are best-effort; a missing tool/path is reported as null.

use std::process::Command;

use serde_json::{json, Value};

use crate::config::{cef_port_candidates, Config};

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
    // The interpreter the daemon would actually spawn (`SHELVES_PYTHON` honoured).
    let python_bin = Config::from_env().python_bin;
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
            "pythonBin": python_bin,
            "python": cmd_out(&python_bin, &["--version"]).map(|s| first_line(&s)),
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

// ── doctor: checks + safe fixes ──────────────────────────────────────────────

/// Outcome of one check. `Ok` = fine, `Warn` = worth noting but not blocking,
/// `Fail` = the thing that stops ShelvesHub from working until fixed.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Ok,
    Warn,
    Fail,
}

impl Status {
    fn glyph(self) -> &'static str {
        match self {
            Status::Ok => "[ok]  ",
            Status::Warn => "[warn]",
            Status::Fail => "[FAIL]",
        }
    }
}

/// One diagnostic line: a name, its outcome, a human detail, and — when not Ok —
/// a concrete next step. `fix` is guidance; only the CEF-flag fix is applied by
/// `--fix` (it is the one safe, idempotent action).
pub struct Check {
    pub name: &'static str,
    pub status: Status,
    pub detail: String,
    pub fix: Option<String>,
}

/// The overall exit status is the worst single check (Fail > Warn > Ok). Pure.
pub fn worst(checks: &[Check]) -> Status {
    checks
        .iter()
        .fold(Status::Ok, |acc, c| match (acc, c.status) {
            (Status::Fail, _) | (_, Status::Fail) => Status::Fail,
            (Status::Warn, _) | (_, Status::Warn) => Status::Warn,
            _ => Status::Ok,
        })
}

/// Classify the CEF remote-debugging flag. Found ⇒ Ok; missing ⇒ Fail (Steam
/// never opens the debug port ShelvesHub needs without it). Pure.
pub fn classify_cef_flag(found: bool, created: bool) -> (Status, Option<String>) {
    if found {
        (Status::Ok, None)
    } else if created {
        (
            Status::Warn,
            Some("created it — restart Steam once so the debug port opens".into()),
        )
    } else {
        (
            Status::Fail,
            Some("re-run with `doctor --fix` (or reinstall), then restart Steam".into()),
        )
    }
}

/// Classify the renderer debug port probe. Reachable ⇒ Ok; not ⇒ Fail. Pure.
pub fn classify_port(reachable: bool) -> (Status, Option<String>) {
    if reachable {
        (Status::Ok, None)
    } else {
        (
            Status::Fail,
            Some("enable the CEF flag (above) and fully restart Steam".into()),
        )
    }
}

/// Classify the Steam-process probe. Running ⇒ Ok; not ⇒ Warn (nothing to inject
/// into yet, but not broken). `None` = couldn't tell (no probe tool) ⇒ Warn. Pure.
pub fn classify_steam(running: Option<bool>) -> (Status, Option<String>) {
    match running {
        Some(true) => (Status::Ok, None),
        Some(false) => (
            Status::Warn,
            Some("start Steam (Big Picture) to host".into()),
        ),
        None => (Status::Warn, None),
    }
}

/// Classify the daemon RPC probe. Answering ⇒ Ok; not ⇒ Warn (the daemon is not
/// up, or listens elsewhere — the service check says which). Pure.
pub fn classify_rpc(reachable: bool) -> (Status, Option<String>) {
    if reachable {
        (Status::Ok, None)
    } else {
        (
            Status::Warn,
            Some("no daemon answering there — start the service, or check `rpc_port`".into()),
        )
    }
}

/// Classify the service-active probe. Active ⇒ Ok; inactive ⇒ Fail; unknown ⇒
/// Warn (not installed as a service, or no probe). Pure.
pub fn classify_service(active: Option<bool>) -> (Status, Option<String>) {
    match active {
        Some(true) => (Status::Ok, None),
        Some(false) => (
            Status::Fail,
            Some("start it (SteamOS/Linux: `systemctl --user restart shelveshub`)".into()),
        ),
        None => (
            Status::Warn,
            Some("not detected as a managed service".into()),
        ),
    }
}

fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
}

/// Steam's install dir on Windows from the per-user registry key the installer
/// also reads (`HKCU\Software\Valve\Steam\SteamPath`), else the default location.
fn windows_steam_root() -> std::path::PathBuf {
    let from_registry = cmd_out(
        "reg",
        &["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"],
    )
    .and_then(|out| {
        let line = out.lines().find(|l| l.contains("REG_SZ"))?;
        let (_, value) = line.split_once("REG_SZ")?;
        let value = value.trim();
        (!value.is_empty()).then(|| std::path::PathBuf::from(value))
    });
    from_registry.unwrap_or_else(|| {
        let base = std::env::var("ProgramFiles(x86)")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "C:\\Program Files (x86)".to_string());
        std::path::PathBuf::from(base).join("Steam")
    })
}

/// Steam roots that may hold the `.cef-enable-remote-debugging` flag, per OS.
fn steam_roots() -> Vec<std::path::PathBuf> {
    if cfg!(target_os = "windows") {
        return vec![windows_steam_root()];
    }
    let Some(home) = home_dir() else {
        return Vec::new();
    };
    if cfg!(target_os = "macos") {
        vec![home.join("Library/Application Support/Steam")]
    } else {
        vec![
            home.join(".steam/steam"),
            home.join(".local/share/Steam"),
            home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
        ]
    }
}

/// Probe + (optionally) fix the CEF flag: found if any Steam root already has it;
/// when `fix` and none do, create it in the first existing root. Returns
/// (found, created).
fn probe_cef_flag(fix: bool) -> (bool, bool) {
    let roots = steam_roots();
    let flag = ".cef-enable-remote-debugging";
    if roots.iter().any(|r| r.join(flag).exists()) {
        return (true, false);
    }
    if fix {
        if let Some(root) = roots.iter().find(|r| r.exists()) {
            if std::fs::File::create(root.join(flag)).is_ok() {
                return (false, true);
            }
        }
    }
    (false, false)
}

/// True if `host:port` answers a TCP connect within 400 ms.
fn tcp_answers(host: &str, port: u16) -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;
    let Ok(addrs) = (host, port).to_socket_addrs() else {
        return false;
    };
    addrs
        .into_iter()
        .any(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok())
}

/// True if the CEF debug port answers on the configured host (any candidate port).
fn probe_cef_port(host: &str, configured: u16) -> bool {
    cef_port_candidates(configured)
        .into_iter()
        .any(|port| tcp_answers(host, port))
}

/// True if the daemon's RPC server answers at its configured `host:port`.
fn probe_rpc_port(rpc_addr: &str) -> bool {
    let Some((host, port)) = rpc_addr.rsplit_once(':') else {
        return false;
    };
    port.parse()
        .map(|port| tcp_answers(host.trim_matches(['[', ']']), port))
        .unwrap_or(false)
}

fn probe_steam_running() -> Option<bool> {
    let name = if cfg!(target_os = "macos") {
        "steam_osx"
    } else if cfg!(target_os = "windows") {
        return None; // no portable pgrep; skip rather than guess
    } else {
        "steam"
    };
    // `pgrep -x` exits 0 only when a match exists; cmd_out returns Some on success.
    Some(cmd_out("pgrep", &["-x", name]).is_some())
}

fn probe_service_active() -> Option<bool> {
    if cfg!(target_os = "linux") {
        // `cat` exits 0 only when the unit exists: absent → None (not managed, a
        // note rather than a failure). Present: `is-active` exits 0 only while it runs.
        cmd_out("systemctl", &["--user", "cat", "shelveshub.service"])?;
        Some(cmd_out("systemctl", &["--user", "is-active", "shelveshub.service"]).is_some())
    } else if cfg!(target_os = "macos") {
        cmd_out(
            "launchctl",
            &["print", &format!("gui/{}/com.shelveshub", current_uid())],
        )
        .map(|_| true)
        .or(Some(false))
    } else {
        None
    }
}

/// Current uid via `id -u` (present on macOS/Linux) — for the per-user launchd
/// domain path; avoids pulling the libc crate for one call.
fn current_uid() -> String {
    cmd_out("id", &["-u"]).unwrap_or_else(|| "0".into())
}

/// Run every check (and apply the CEF-flag fix when `fix`), newest-first severity.
/// Ports and addresses come from the same config resolution the daemon uses.
pub fn run_doctor(fix: bool) -> Vec<Check> {
    let config = Config::from_env();
    let (found, created) = probe_cef_flag(fix);
    let (cef_status, cef_fix) = classify_cef_flag(found, created);
    let cef_detail = if found {
        "Steam CEF remote-debugging flag present".into()
    } else if created {
        "Steam CEF remote-debugging flag was missing — created".into()
    } else {
        "Steam CEF remote-debugging flag missing".into()
    };

    let (port_status, port_fix) = classify_port(probe_cef_port(&config.cef_host, config.cef_port));
    let ports = cef_port_candidates(config.cef_port)
        .iter()
        .map(u16::to_string)
        .collect::<Vec<_>>()
        .join("/");
    let (steam_status, steam_fix) = classify_steam(probe_steam_running());
    let (rpc_status, rpc_fix) = classify_rpc(probe_rpc_port(&config.rpc_addr));
    let (svc_status, svc_fix) = classify_service(probe_service_active());

    vec![
        Check {
            name: "CEF debug flag",
            status: cef_status,
            detail: cef_detail,
            fix: cef_fix,
        },
        Check {
            name: "Renderer debug port",
            status: port_status,
            detail: format!("CEF port on {} ({ports})", config.cef_host),
            fix: port_fix,
        },
        Check {
            name: "Steam running",
            status: steam_status,
            detail: "Steam process".into(),
            fix: steam_fix,
        },
        Check {
            name: "Daemon RPC",
            status: rpc_status,
            detail: format!("local RPC at {}", config.rpc_addr),
            fix: rpc_fix,
        },
        Check {
            name: "ShelvesHub service",
            status: svc_status,
            detail: "background service active".into(),
            fix: svc_fix,
        },
    ]
}

/// `shelveshub doctor [--fix]`: print the checks, apply the safe fix when asked,
/// and exit non-zero if anything failed (so a script can gate on it).
pub fn print_doctor(fix: bool) {
    let checks = run_doctor(fix);
    println!("ShelvesHub doctor{}:\n", if fix { " (--fix)" } else { "" });
    for c in &checks {
        println!("  {} {} — {}", c.status.glyph(), c.name, c.detail);
        if let Some(f) = &c.fix {
            if c.status != Status::Ok {
                println!("         → {f}");
            }
        }
    }
    let overall = worst(&checks);
    println!(
        "\n{}",
        match overall {
            Status::Ok => "All good.",
            Status::Warn => "Mostly fine — see the notes above.",
            Status::Fail => "Problems found — follow the steps above, then re-run `doctor`.",
        }
    );
    if overall == Status::Fail {
        std::process::exit(1);
    }
}

#[cfg(test)]
#[path = "tests/report_tests.rs"]
mod tests;
