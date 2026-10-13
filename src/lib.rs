//! ShelvesHub — shared library.
//!
//! The CDP client, configuration, logging and injection state live here so
//! the binaries can reuse them:
//!
//! - `shelveshub`       — the background service ([`loader`] + [`rpc`]).
//! - `shelves-devtools` — the cross-platform CDP developer tool.
//! - `shelveshub-tray`  — the tray companion (config and the RPC token path).

pub mod backend;
pub mod bootmovie;
pub mod cdp;
pub mod config;
pub mod constants;
pub mod loader;
pub mod logger;
pub mod populate;
pub mod report;
pub mod rpc;
pub mod semver;
pub mod state;
pub mod store;
pub mod sync;

/// Version of the `HostApi` contract this loader implements. **Derived** at build
/// time from the shared `@deck-shelves/host` contract (`host/dist/index.d.ts`) via
/// `build.rs`, so it never drifts from the contract; the injected runtime receives
/// the same value stamped by the loader (no hardcoded copy). Served over RPC as
/// `getHostApiVersion` so a bundle can handshake before relying on host capabilities.
pub const HOST_API_VERSION: &str = env!("SHELVES_HOST_API_VERSION");
