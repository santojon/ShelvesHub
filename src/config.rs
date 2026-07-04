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
        }
    }

    /// The `http://host:port` base of the DevTools HTTP discovery endpoint.
    pub fn cef_http_base(&self) -> String {
        format!("http://{}:{}", self.cef_host, self.cef_port)
    }

    pub fn summary(&self) -> String {
        format!(
            "cef={}:{} rpc={} host_runtime={} bundle={} target={} interval={}s",
            self.cef_host,
            self.cef_port,
            self.rpc_addr,
            self.host_runtime_path.display(),
            self.bundle_path.display(),
            self.target_filter.as_deref().unwrap_or("<auto>"),
            self.interval_secs,
        )
    }
}

fn env_string(key: &str, default: &str) -> String {
    env::var(key).ok().filter(|s| !s.is_empty()).unwrap_or_else(|| default.to_string())
}

fn env_u16(key: &str, default: u16) -> u16 {
    env::var(key).ok().and_then(|s| s.parse().ok()).unwrap_or(default)
}

fn env_u64(key: &str, default: u64) -> u64 {
    env::var(key).ok().and_then(|s| s.parse().ok()).unwrap_or(default)
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
