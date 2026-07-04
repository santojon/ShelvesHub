//! Shared injection state.
//!
//! The injection loop writes the latest observed state; the RPC server reads it
//! to answer `isInjected`. A plain atomic is enough — there is exactly one
//! writer (the loader loop) and many readers (RPC connections).

use std::sync::atomic::{AtomicBool, Ordering};

static INJECTED: AtomicBool = AtomicBool::new(false);
static BUNDLE_READY: AtomicBool = AtomicBool::new(false);

/// Record whether the Deck Shelves bundle is currently active in the renderer.
pub fn set_injected(value: bool) {
    INJECTED.store(value, Ordering::Relaxed);
}

/// Whether the bundle was active as of the last loop tick.
pub fn is_injected() -> bool {
    INJECTED.load(Ordering::Relaxed)
}

/// Record that the injected bundle has fully initialised. Set from the RPC
/// server when the bundle calls `bundleReady`; distinct from `INJECTED` (which
/// the loop derives from the renderer probe) because it is the bundle's own
/// confirmation that it finished booting against the host API.
pub fn set_bundle_ready(value: bool) {
    BUNDLE_READY.store(value, Ordering::Relaxed);
}

/// Whether the bundle has confirmed full initialisation via `bundleReady`.
pub fn is_bundle_ready() -> bool {
    BUNDLE_READY.load(Ordering::Relaxed)
}
