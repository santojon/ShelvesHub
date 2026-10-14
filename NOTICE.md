# Notice — Acknowledgements

ShelvesHub (MIT) is the independent host for Deck Shelves — the process that
injects Deck Shelves into Steam **and** the injected host runtime
(`runtime/shelves-host.js`, the concrete `window.__SHELVES_HOST__`) that provides
the Steam UI layer and the Quick Access Menu tab. It was written independently
(clean-room): no third-party source is copied into it. The service builds on
permissively licensed Rust crates (declared in `Cargo.toml`), the injected runtime
uses no third-party package, and the test harness's React builds kept in the
repository are covered below.

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
**React** and **ReactDOM** 18.3.1 (Meta Platforms, Inc., MIT) — the production
UMD builds, kept in this repository under `examples/harness/vendor/` with their
license headers intact (the harness downloads them only when they are missing).
They are a **development/test dependency only**: not part of the service, the
injected runtime, or any release artifact, and their MIT license is compatible
with this project's.

## Project site

The landing page under `site/` is self-contained static HTML, CSS and JavaScript written for
this project, with no third-party library. When its visit counter is enabled
(`site/analytics.json`), the published page loads the counter script of a privacy-respecting
hosted service at view time and says so in its footer; nothing of that service is redistributed
here.

## Steam / SteamOS

ShelvesHub drives Steam's CEF renderer via the DevTools protocol and locates
and renders Steam's own UI components at runtime. Steam, SteamOS, and Steam Deck
are trademarks of Valve Corporation. This is an unofficial, community project,
not affiliated with or endorsed by Valve, and it redistributes none of Steam's
components.
