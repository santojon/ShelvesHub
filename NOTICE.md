# Notice — Acknowledgements & Inspirations

ShelvesHub (MIT) is the independent host for Deck Shelves — the process that
injects Deck Shelves into Steam **and** the injected host runtime
(`runtime/shelves-host.js`, the concrete `window.__SHELVES_HOST__`) that provides
the Steam UI layer and the Quick Access Menu tab. It was written independently
(clean-room): no source is copied from the projects below, and none of their
packages are redistributed.

This file is explicit about **which techniques** the loader re-implements —
covering both the injector daemon and the host runtime, which both live here.
(The shared `HostApi` *contract* is a separate types-only package,
[`@deck-shelves/host`](https://github.com/santojon/Deck-Shelves/tree/main/host),
which reimplements nothing and carries no acknowledgements.)

If you maintain one of the projects below and would like the wording, link, or
attribution adjusted, please open an issue — this is honest credit, not a claim
of endorsement or affiliation.

## Inspirations

- **[plugin loader](https://github.com/SteamDeckHomebrew/a plugin loader)** (GPL-2.0)
  — reference for two techniques: (1) the **injector-daemon** concept — enabling
  Steam's CEF remote debugging, discovering the Steam renderer target, injecting
  a script/bundle over the DevTools protocol, and tracking the renderer lifecycle
  to re-inject across Steam restarts; and (2) the **Quick Access Menu
  tab-insertion** approach — patching the QAM component to add a custom tab.
  Behaviour was studied and re-implemented from scratch (the daemon in Rust
  against the public Chrome DevTools Protocol; the QAM patch in the injected
  runtime); no plugin loader code (GPL-2.0) was copied or adapted — deliberately
  avoided to keep the loader under the MIT license.

- **[a frontend library](https://github.com/SteamDeckHomebrew/a frontend library)
  / `the packages` / `the packages`** (LGPL-2.1) — reference for **locating Steam's
  own webpack UI modules** and for the **React-tree patch helpers** (`afterPatch`,
  `findInReactTree`, fiber refresh) the injected runtime uses to render
  Steam-native UI. Re-implemented from scratch; these packages are never bundled.

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
