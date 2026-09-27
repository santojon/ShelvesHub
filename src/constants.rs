//! Central constants — every tunable timer, default value, and pinned URL in one
//! place, so they are not scattered inline across the modules. Grouped by kind.
//!
//! What is deliberately NOT here: tables that are part of a module's own contract
//! rather than tunables — the RPC method allowlist and editable-config keys
//! (`rpc`), and the injected runtime's JS global names and fragment list
//! (`loader`). Those live with the code that defines their meaning.

/// Timers and intervals. Every duration the daemon waits on is defined here.
pub mod timers {
    use std::time::Duration;

    /// How long to wait for one backend RPC call before giving up.
    pub const CALL_TIMEOUT: Duration = Duration::from_secs(75);
    /// Minimum gap between backend respawns after it exits.
    pub const RESPAWN_COOLDOWN: Duration = Duration::from_secs(10);
    /// CDP websocket read/connect timeout.
    pub const WS_TIMEOUT: Duration = Duration::from_secs(10);
    /// CDP `/json` discovery HTTP timeout.
    pub const HTTP_TIMEOUT: Duration = Duration::from_secs(5);
    /// RPC socket read timeout (slowloris guard).
    pub const READ_TIMEOUT: Duration = Duration::from_secs(15);
    /// How often the daemon checks for a newer release while settled.
    pub const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(30 * 60);
    /// Idle re-poll cadence while WE host the bundle (sole/owner).
    pub const SOLE_IDLE: Duration = Duration::from_secs(5);
    /// Fast re-poll cadence: cold start and desktop stand-down, so a return to
    /// Big Picture is noticed within a couple of seconds.
    pub const FAST_POLL: Duration = Duration::from_secs(2);
}

/// Default values and fixed limits.
pub mod defaults {
    /// Steam's CEF DevTools host/port (its own localhost debug endpoint).
    pub const DEFAULT_CEF_HOST: &str = "127.0.0.1";
    pub const DEFAULT_CEF_PORT: u16 = 8080;
    /// The daemon's local control RPC host/port.
    pub const DEFAULT_RPC_HOST: &str = "127.0.0.1";
    pub const DEFAULT_RPC_PORT: u16 = 60123;
    /// A real Deck Shelves IIFE is at least this large; the shipped placeholder is
    /// far smaller, so this tells them apart.
    pub const REAL_BUNDLE_MIN_BYTES: u64 = 4096;
    /// Cap on the in-memory log ring the fallback viewer reads.
    pub const LOG_RING_CAP: usize = 300;
    /// Largest RPC request body the daemon will read (2 MiB).
    pub const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
    /// Consecutive collapsed-UI observations before injection halts.
    pub const COLLAPSE_HALT_THRESHOLD: u32 = 2;
}

/// Pinned release/API URLs. Injection-facing downloads only ever come from these.
pub mod urls {
    /// Deck Shelves latest stable release (GitHub API).
    pub const RELEASES_LATEST_URL: &str =
        "https://api.github.com/repos/santojon/Deck-Shelves/releases/latest";
    /// Deck Shelves all releases, newest first, including pre-releases.
    pub const RELEASES_ALL_URL: &str =
        "https://api.github.com/repos/santojon/Deck-Shelves/releases";
    /// The only host+path a self-installed bundle may come from.
    pub const TRUSTED_BUNDLE_PREFIX: &str =
        "https://github.com/santojon/Deck-Shelves/releases/download/";
    /// ShelvesHub's OWN latest release (the hub self-update check).
    pub const HUB_RELEASES_LATEST_URL: &str =
        "https://api.github.com/repos/santojon/ShelvesHub/releases/latest";
    /// ShelvesHub's OWN releases, newest first, including pre-releases.
    pub const HUB_RELEASES_ALL_URL: &str =
        "https://api.github.com/repos/santojon/ShelvesHub/releases";
}
