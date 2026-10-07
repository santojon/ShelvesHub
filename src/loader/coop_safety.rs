//! Coexistence-safety policy. Pure decision logic the injection loop feeds:
//! when cooperative ownership (force + a loader present) keeps coinciding with a
//! confirmed Steam-UI collapse, recede to plain coexist for the session so a
//! churning force never fights the loader in a restart/collapse loop. The loop
//! owns the signals and acts on the verdict; nothing here touches the renderer.

/// Tracks confirmed collapses seen while ownership is forced and decides when to
/// stand force down. One-way for the session: once receded it stays receded (a
/// restart re-reads config and starts clean).
pub struct CoopSafety {
    enabled: bool,
    threshold: u32,
    strikes: u32,
    receded: bool,
}

impl CoopSafety {
    pub fn new(enabled: bool, threshold: u32) -> Self {
        Self {
            enabled,
            threshold: threshold.max(1),
            strikes: 0,
            receded: false,
        }
    }

    /// Record a confirmed UI collapse that happened while force was in effect.
    /// Returns true exactly once — the tick the strikes reach the threshold — so
    /// the caller recedes and logs a single time.
    pub fn collapse_while_forced(&mut self) -> bool {
        if !self.enabled || self.receded {
            return false;
        }
        self.strikes += 1;
        if self.strikes >= self.threshold {
            self.receded = true;
            return true;
        }
        false
    }

    /// A healthy, settled tick clears the strike streak (until actually receded):
    /// only *consecutive* collapses while forced count toward standing down.
    pub fn settled_ok(&mut self) {
        if !self.receded {
            self.strikes = 0;
        }
    }

    pub fn receded(&self) -> bool {
        self.receded
    }
}

/// Lockstep guard. A hub-driven plugin-bundle swap is safe only when the
/// hub actually owns the bundle. In plain cooperative mode the loader owns the
/// on-disk copy, so a hub swap would leave the two on divergent versions (the
/// two-copies / router-repatch class of breakage) — defer to the loader. The
/// cooperative-bundle protocol, when enabled, hands the hub the bundle, so a swap
/// is safe again.
pub fn coop_plugin_swap_allowed(cooperative: bool, coop_bundle: bool) -> bool {
    !cooperative || coop_bundle
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recedes_once_at_threshold() {
        let mut s = CoopSafety::new(true, 2);
        assert!(!s.collapse_while_forced()); // strike 1
        assert!(!s.receded());
        assert!(s.collapse_while_forced()); // strike 2 → recede, fires once
        assert!(s.receded());
        assert!(!s.collapse_while_forced()); // already receded, no refire
    }

    #[test]
    fn healthy_tick_clears_the_streak() {
        let mut s = CoopSafety::new(true, 2);
        assert!(!s.collapse_while_forced()); // strike 1
        s.settled_ok(); // recovered — streak reset
        assert!(!s.collapse_while_forced()); // strike 1 again, not 2
        assert!(!s.receded());
    }

    #[test]
    fn disabled_never_recedes() {
        let mut s = CoopSafety::new(false, 1);
        assert!(!s.collapse_while_forced());
        assert!(!s.collapse_while_forced());
        assert!(!s.receded());
    }

    #[test]
    fn threshold_floored_at_one() {
        let mut s = CoopSafety::new(true, 0);
        assert!(s.collapse_while_forced()); // threshold clamped to 1 → recede now
        assert!(s.receded());
    }

    #[test]
    fn swap_allowed_only_when_safe() {
        assert!(coop_plugin_swap_allowed(false, false)); // sole/owner — safe
        assert!(coop_plugin_swap_allowed(false, true));
        assert!(!coop_plugin_swap_allowed(true, false)); // plain cooperative — defer
        assert!(coop_plugin_swap_allowed(true, true)); // coop-bundle protocol — hub owns it
    }
}
