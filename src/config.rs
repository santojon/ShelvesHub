//! Runtime configuration, resolved from environment variables with sane
//! defaults. Every value is overridable so the same binary works on a Steam
//! Deck, on a developer laptop, or against a locally-launched Chromium for
//! testing (see `docs/debugging.md`).

use std::env;
use std::path::PathBuf;

use serde_json::Value;

/// Default Chrome DevTools Protocol host. Steam exposes CEF remote debugging
/// on localhost when `.cef-enable-remote-debugging` is present.
pub const DEFAULT_CEF_HOST: &str = "127.0.0.1";
/// Steam's CEF remote-debugging port. Used by both the loader and devtools.
pub const DEFAULT_CEF_PORT: u16 = 8080;
/// Default host the RPC server binds to (loopback — the bundle is same-machine).
pub const DEFAULT_RPC_HOST: &str = "127.0.0.1";
/// Default TCP port for the host RPC server consumed by the bundle.
pub const DEFAULT_RPC_PORT: u16 = 60123;

#[derive(Debug, Clone)]
pub struct Config {
    /// Host of the CEF/Chromium DevTools endpoint.
    pub cef_host: String,
    /// Port of the CEF/Chromium DevTools endpoint.
    pub cef_port: u16,
    /// Address the host RPC server binds to.
    pub rpc_addr: String,
    /// Absolute path to the bundle injected into the renderer.
    pub bundle_path: PathBuf,
    /// Absolute path to the host runtime injected before the bundle. Provides
    /// `window.__SHELVES_HOST__` (the HostApi implementation, incl. QAM panels).
    pub host_runtime_path: PathBuf,
    /// Case-insensitive substring used to pick the renderer target. When unset
    /// the loader auto-detects the Steam shared JS context / Big Picture window.
    pub target_filter: Option<String>,
    /// Seconds between injection-loop ticks.
    pub interval_secs: u64,
    /// Directory containing the Deck Shelves Python backend (`main.py` etc.).
    /// Unset = backend hosting disabled; data RPC methods return an error.
    pub backend_dir: Option<PathBuf>,
    /// Path to the backend runner script spawned to host the backend.
    pub backend_runner_path: PathBuf,
    /// Python interpreter used to run the backend.
    pub python_bin: String,
    /// Directory where the backend keeps `settings.json` (exported to the
    /// backend process, which reads it before any of its own fallbacks).
    pub settings_dir: PathBuf,
    /// When true (`SHELVES_FORCE_OWNER=shelveshub`), inject even if another
    /// host adapter already owns the renderer; the owner-preference global is
    /// stamped so the other adapter stands down cooperatively.
    pub force_owner: bool,
    /// When true (`SHELVES_NATIVE_QAM=1`), stamp the renderer so the injected
    /// runtime attempts the native Quick Access tab (guarded by a trip
    /// breaker; overlay remains the fallback). Off by default.
    pub native_qam: bool,
    /// Optional shell command (`SHELVES_RECOVER_CMD`) run once when the loader
    /// detects the Steam UI windows have collapsed (a black screen where only
    /// `SharedJSContext` survives). Unset by default — the loader then only
    /// pauses injection and logs the recovery hint. On a device this is
    /// typically `systemctl --user restart steam-launcher.service`; from a dev
    /// host, `scripts/recover-deck.sh`. Never `StartRestart` — it worsens this.
    pub recover_cmd: Option<String>,
    /// When true (`SHELVES_PRELOAD=1`), register the host runtime at document-
    /// start (browser auto-attach + `Page.addScriptToEvaluateOnNewDocument`)
    /// instead of evaluating it into the live page. It then runs at idle boot —
    /// before the plugin loads and renders — so its heavy webpack enumeration
    /// never blocks a busy renderer (the native QAM path's late-inject failure
    /// mode: a blocked main thread starves the plugin's async shelf resolves →
    /// React teardown). Off by default; the injection loop is the default path.
    pub preload: bool,
    /// When true (`SHELVES_PRERELEASE=1`), the bundle "populate" download step
    /// considers pre-release Deck Shelves releases (picking the newest overall)
    /// instead of only the latest stable — the sole-host equivalent of the
    /// plugin's beta channel. Off by default.
    pub prerelease: bool,
    /// Seconds to wait for another host to claim an unclaimed renderer before we
    /// host it ourselves (`SHELVES_OWNER_SETTLE_SECS`, default 0 = off). A sole
    /// host wants an immediate boot (0); a coexistence deployment sets this (~25)
    /// so a fast tick never injects owner-mode ahead of the other host's pending
    /// claim — which would hijack it. Only applies while the renderer is unclaimed.
    pub owner_settle_secs: u64,
    /// Path to the host's own settings store (`SHELVES_HUB_CONFIG`; default
    /// `<settings_dir>/shelveshub.json`) — the auto-update preference and future
    /// host settings, persisted with atomic writes + a backup (see `store`).
    pub hub_config_path: PathBuf,
}

impl Config {
    pub fn from_env() -> Self {
        let settings_dir = env::var("SHELVES_SETTINGS_DIR")
            .ok()
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(default_settings_dir);
        let hub_config_path = env::var("SHELVES_HUB_CONFIG")
            .ok()
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| settings_dir.join("shelveshub.json"));
        // Optional external config file (JSON) for the tunable hub settings, so
        // one-off changes need no rebuild and no long env-var lines. Precedence per
        // setting: env var > config file > built-in default.
        let file = load_config_file();
        Config {
            cef_host: cfg_string(&file, "SHELVES_CEF_HOST", "cef_host", DEFAULT_CEF_HOST),
            cef_port: cfg_u16(&file, "SHELVES_CEF_PORT", "cef_port", DEFAULT_CEF_PORT),
            rpc_addr: format!(
                "{}:{}",
                cfg_string(&file, "SHELVES_RPC_HOST", "rpc_host", DEFAULT_RPC_HOST),
                cfg_u16(&file, "SHELVES_RPC_PORT", "rpc_port", DEFAULT_RPC_PORT)
            ),
            bundle_path: resolve_asset_path("SHELVES_BUNDLE_PATH", "bundle/index.js"),
            host_runtime_path: resolve_asset_path(
                "SHELVES_HOST_RUNTIME_PATH",
                "runtime/shelves-host.js",
            ),
            target_filter: env::var("SHELVES_TARGET")
                .ok()
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    file.get("target")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                }),
            interval_secs: cfg_u64(&file, "SHELVES_INTERVAL_SECS", "interval_secs", 30),
            backend_dir: env::var("SHELVES_BACKEND_DIR")
                .ok()
                .filter(|s| !s.is_empty())
                .map(PathBuf::from)
                .or_else(default_backend_dir),
            backend_runner_path: resolve_asset_path(
                "SHELVES_BACKEND_RUNNER_PATH",
                "runtime/backend/shelveshub_backend.py",
            ),
            python_bin: env_string("SHELVES_PYTHON", default_python()),
            settings_dir,
            force_owner: match env::var("SHELVES_FORCE_OWNER") {
                Ok(v) => v.eq_ignore_ascii_case("shelveshub"),
                Err(_) => file.get("force_owner").and_then(Value::as_bool).unwrap_or(false),
            },
            native_qam: cfg_bool(&file, "SHELVES_NATIVE_QAM", "native_qam"),
            recover_cmd: env::var("SHELVES_RECOVER_CMD")
                .ok()
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    file.get("recover_cmd")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                }),
            preload: env_bool("SHELVES_PRELOAD"),
            prerelease: cfg_bool(&file, "SHELVES_PRERELEASE", "prerelease"),
            owner_settle_secs: cfg_u64(&file, "SHELVES_OWNER_SETTLE_SECS", "owner_settle_secs", 0),
            hub_config_path,
        }
    }

    pub fn summary(&self) -> String {
        format!(
            "cef={}:{} rpc={} host_runtime={} bundle={} target={} interval={}s backend={} settings={} hub_config={}{}{}{}{}{}{}",
            self.cef_host,
            self.cef_port,
            self.rpc_addr,
            self.host_runtime_path.display(),
            self.bundle_path.display(),
            self.target_filter.as_deref().unwrap_or("<auto>"),
            self.interval_secs,
            self.backend_dir
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "<disabled>".to_string()),
            self.settings_dir.display(),
            self.hub_config_path.display(),
            if self.force_owner { " force_owner=shelveshub" } else { "" },
            if self.native_qam { " native_qam=on" } else { "" },
            if self.recover_cmd.is_some() { " recover_cmd=set" } else { "" },
            if self.preload { " preload=on" } else { "" },
            if self.prerelease { " prerelease=on" } else { "" },
            if self.owner_settle_secs > 0 {
                format!(" owner_settle={}s", self.owner_settle_secs)
            } else {
                String::new()
            },
        )
    }
}

/// Installed layout auto-detection: a backend payload dropped at
/// `<exe_dir>/backend/main.py` enables hosting without any configuration.
fn default_backend_dir() -> Option<PathBuf> {
    let exe = env::current_exe().ok()?;
    let candidate = exe.parent()?.join("backend");
    candidate.join("main.py").is_file().then_some(candidate)
}

fn default_python() -> &'static str {
    if cfg!(windows) {
        "python"
    } else {
        "python3"
    }
}

/// Per-OS default for the ShelvesHub settings store. Mirrors the runner's
/// own fallback so both sides agree when neither env var is set.
fn default_settings_dir() -> PathBuf {
    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    if cfg!(windows) {
        let base = env::var("APPDATA").unwrap_or(home);
        PathBuf::from(base).join("deck-shelves")
    } else if cfg!(target_os = "macos") {
        PathBuf::from(home).join("Library/Application Support/deck-shelves")
    } else {
        let base = env::var("XDG_DATA_HOME")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("{home}/.local/share"));
        PathBuf::from(base).join("deck-shelves")
    }
}

fn env_string(key: &str, default: &str) -> String {
    env::var(key)
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default.to_string())
}

/// A boolean flag env var: true for `1` or `true` (case-insensitive), else false.
fn env_bool(key: &str) -> bool {
    env::var(key)
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Load the optional external config file (JSON): `SHELVES_CONFIG_FILE` if set,
/// otherwise `<exe_dir>/shelveshub.config.json`. Absent / unreadable / invalid →
/// an empty value, so every setting falls through to its env override or default.
fn load_config_file() -> Value {
    let path = env::var("SHELVES_CONFIG_FILE")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            env::current_exe()
                .ok()
                .and_then(|e| e.parent().map(|d| d.join("shelveshub.config.json")))
        });
    match path {
        Some(p) if p.is_file() => std::fs::read_to_string(&p)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

// Setting resolvers: env var > config file (`json_key`) > default.
fn cfg_string(file: &Value, env_key: &str, json_key: &str, default: &str) -> String {
    env::var(env_key)
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| file.get(json_key).and_then(Value::as_str).map(String::from))
        .unwrap_or_else(|| default.to_string())
}

fn cfg_u16(file: &Value, env_key: &str, json_key: &str, default: u16) -> u16 {
    env::var(env_key)
        .ok()
        .and_then(|s| s.parse().ok())
        .or_else(|| file.get(json_key).and_then(Value::as_u64).map(|v| v as u16))
        .unwrap_or(default)
}

fn cfg_u64(file: &Value, env_key: &str, json_key: &str, default: u64) -> u64 {
    env::var(env_key)
        .ok()
        .and_then(|s| s.parse().ok())
        .or_else(|| file.get(json_key).and_then(Value::as_u64))
        .unwrap_or(default)
}

fn cfg_bool(file: &Value, env_key: &str, json_key: &str) -> bool {
    if let Ok(v) = env::var(env_key) {
        return v == "1" || v.eq_ignore_ascii_case("true");
    }
    file.get(json_key).and_then(Value::as_bool).unwrap_or(false)
}

/// Resolve an asset path: explicit env override wins, otherwise look next to the
/// executable (`<exe_dir>/<relative>`, the install layout), falling back to
/// `<relative>` relative to the current directory (dev runs).
fn resolve_asset_path(env_key: &str, relative: &str) -> PathBuf {
    if let Some(p) = env::var(env_key).ok().filter(|s| !s.is_empty()) {
        return PathBuf::from(p);
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(relative);
            if candidate.exists() {
                return candidate;
            }
        }
    }

    PathBuf::from(relative)
}

#[cfg(test)]
mod tests {
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
}
