//! ShelvesHub — shared library.
//!
//! The CDP client, configuration, logging and injection state live here so
//! both binaries can reuse them:
//!
//! - `loader`           — the background service ([`loader`] + [`rpc`]).
//! - `shelves-devtools` — the cross-platform CDP developer tool.

pub mod cdp;
pub mod config;
pub mod loader;
pub mod logger;
pub mod rpc;
pub mod state;

/// Version of the `HostApi` contract this loader implements. Mirrors
/// `HOST_API_VERSION` in `src/runtime/host/contract.ts` (and the injected host
/// runtime) — keep the two in sync. Served over RPC as `getHostApiVersion` so a
/// bundle can perform a startup handshake before relying on host capabilities.
pub const HOST_API_VERSION: &str = "1.1.0";
