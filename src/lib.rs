//! ShelvesHub — shared library.
//!
//! The CDP client, configuration, logging and injection state live here so
//! both binaries can reuse them:
//!
//! - `loader`           — the background service ([`loader`] + [`rpc`]).
//! - `shelves-devtools` — the cross-platform CDP developer tool.

pub mod backend;
pub mod cdp;
pub mod config;
pub mod loader;
pub mod logger;
pub mod populate;
pub mod rpc;
pub mod state;
pub mod store;

/// Version of the `HostApi` contract this loader implements. **Derived** at build
/// time from the shared `@deck-shelves/host` contract (`host/dist/index.d.ts`) via
/// `build.rs`, so it never drifts from the contract; the injected runtime receives
/// the same value stamped by the loader (no hardcoded copy). Served over RPC as
/// `getHostApiVersion` so a bundle can handshake before relying on host capabilities.
pub const HOST_API_VERSION: &str = env!("SHELVES_HOST_API_VERSION");
