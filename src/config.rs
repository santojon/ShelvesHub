//! Runtime configuration, resolved from environment variables with sane
//! defaults. Every value is overridable so the same binary works on a Steam
//! Deck, on a developer laptop, or against a locally-launched Chromium for
//! testing (see `docs/debugging.md`).

use std::env;
use std::path::PathBuf;

/// Default Chrome DevTools Protocol host. Steam exposes CEF remote debugging
/// on localhost when `.cef-enable-remote-debugging` is present.
pub const DEFAULT_CEF_HOST: &str = "127.0.0.1";
/// Steam's CEF remote-debugging port. Used by both the loader and devtools.
pub const DEFAULT_CEF_PORT: u16 = 8080;
/// Local TCP address for the host RPC server consumed by the bundle.
pub const DEFAULT_RPC_ADDR: &str = "127.0.0.1:60123";

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
}

impl Config {
    pub fn from_env() -> Self {
        Config {
            cef_host: env_string("SHELVES_CEF_HOST", DEFAULT_CEF_HOST),
            cef_port: env_u16("SHELVES_CEF_PORT", DEFAULT_CEF_PORT),
            rpc_addr: env_string("SHELVES_RPC_ADDR", DEFAULT_RPC_ADDR),
            bundle_path: resolve_asset_path("SHELVES_BUNDLE_PATH", "bundle/index.js"),
            host_runtime_path: resolve_asset_path(
                "SHELVES_HOST_RUNTIME_PATH",
                "runtime/shelves-host.js",
            ),
            target_filter: env::var("SHELVES_TARGET").ok().filter(|s| !s.is_empty()),
            interval_secs: env_u64("SHELVES_INTERVAL_SECS", 30),
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
            settings_dir: env::var("SHELVES_SETTINGS_DIR")
                .ok()
                .filter(|s| !s.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(default_settings_dir),
            force_owner: env::var("SHELVES_FORCE_OWNER")
                .map(|v| v.eq_ignore_ascii_case("shelveshub"))
                .unwrap_or(false),
            native_qam: env_bool("SHELVES_NATIVE_QAM"),
            recover_cmd: env::var("SHELVES_RECOVER_CMD")
                .ok()
                .filter(|s| !s.is_empty()),
            preload: env_bool("SHELVES_PRELOAD"),
            prerelease: env_bool("SHELVES_PRERELEASE"),
        }
    }

    pub fn summary(&self) -> String {
        format!(
            "cef={}:{} rpc={} host_runtime={} bundle={} target={} interval={}s backend={} settings={}{}{}{}{}{}",
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
            if self.force_owner { " force_owner=shelveshub" } else { "" },
            if self.native_qam { " native_qam=on" } else { "" },
            if self.recover_cmd.is_some() { " recover_cmd=set" } else { "" },
            if self.preload { " preload=on" } else { "" },
            if self.prerelease { " prerelease=on" } else { "" },
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

fn env_u16(key: &str, default: u16) -> u16 {
    env::var(key)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(default)
}

fn env_u64(key: &str, default: u64) -> u64 {
    env::var(key)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(default)
}

/// A boolean flag env var: true for `1` or `true` (case-insensitive), else false.
fn env_bool(key: &str) -> bool {
    env::var(key)
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
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
