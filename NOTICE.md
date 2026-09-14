# Notice — Acknowledgements

ShelvesHub (MIT) is the independent host for Deck Shelves — the process that
injects Deck Shelves into Steam **and** the injected host runtime
(`runtime/shelves-host.js`, the concrete `window.__SHELVES_HOST__`) that provides
the Steam UI layer and the Quick Access Menu tab. It was written independently
(clean-room): no third-party source is copied, and no third-party packages are
redistributed.

## Techniques

Two host techniques are established patterns in the Steam plugin ecosystem and are
re-implemented here from scratch:

- an **injector daemon** — enabling Steam's CEF remote debugging, discovering the
  Steam renderer target, injecting a script/bundle over the DevTools protocol, and
  tracking the renderer lifecycle to re-inject across Steam restarts (the daemon in
  Rust against the public Chrome DevTools Protocol);
- a **Quick Access Menu tab insertion** — patching the QAM component to add a
  custom tab (in the injected runtime).

Locating Steam's own webpack UI modules and the React-tree patch helpers
(`afterPatch`, `findInReactTree`, fiber refresh) the runtime uses to render
Steam-native UI are likewise re-implemented from scratch. No third-party code was
copied or adapted — deliberately, to keep this project under the MIT license.

## Test harness dependencies

The scenario harness (`examples/harness/`, run by `scripts/harness.sh`) exercises
the injected runtime against a mock of Steam's UI in a headless browser. It uses
**React** and **ReactDOM** (Meta Platforms, Inc., MIT) — the production UMD
builds — fetched on demand into `examples/harness/vendor/` (git-ignored). They are
a **development/test dependency only**: not committed here, not part of the
service, the injected runtime, or any release artifact, and their MIT license is
compatible with this project's.

## Steam / SteamOS

ShelvesHub drives Steam's CEF renderer via the DevTools protocol and locates
and renders Steam's own UI components at runtime. Steam, SteamOS, and Steam Deck
are trademarks of Valve Corporation. This is an unofficial, community project,
not affiliated with or endorsed by Valve, and it redistributes none of Steam's
components.
