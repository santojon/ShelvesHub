# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added
- The native Quick Access tab now renders **native Steam controls** — real buttons
  and toggles with a gamepad focus ring — and carries a **tintable ShelvesHub
  icon**. Alongside another host it draws these from the host environment with no
  start-up scan, so the tab appears without disturbing the running interface.
- **Clickable installers** for macOS (an installer app) and Windows (a setup
  program), each carrying the ShelvesHub icon, alongside the existing one-click
  scripts for SteamOS, Linux, macOS and Windows.
- The host can **install a Deck Shelves update itself** — it fetches the release
  and swaps the bundle in place, then reloads — so updating no longer needs a
  manual file install.
- Every failure path in the service now writes a log line, so problems surface in
  the service log rather than failing silently.
- When Deck Shelves cannot be loaded, the host's own tab now shows a **ShelvesHub
  panel** with recovery actions instead of an empty tab; the home always loads
  regardless. Each action carries an icon, and **Automatic updates** is a real
  on/off toggle whose state is saved. It is also reachable from a **ShelvesHub
  button at the end of the host's own tab even while Deck Shelves is loaded**, and
  its text is **localized into 19 languages** from per-locale files under
  `runtime/i18n/` (the service inlines them at injection time).
- Running alongside another host, the host's own Quick Access tab now shows **the
  plugin's editor mirrored** into it — the plugin populates it through a
  host-neutral bridge, so one tab reaches the real editor and the other host's
  copy is left untouched.
- The host keeps its **own settings** (currently the automatic-updates preference)
  in a small store — `SHELVES_HUB_CONFIG` (default `<settings_dir>/shelveshub.json`)
  — written atomically with a rolling backup and healed from that backup if the
  file is ever missing or corrupt, so a crash or a bad shutdown never loses or
  corrupts it.
- New requests `getConfig`, `setAutoUpdate`, `getLogs` and `pushLogs` back the
  fallback panel's toggle and log view.
- The **Logs view now shows one merged stream** — the host runtime and the
  service side by side, newest first — where every line carries a **level**
  (info / warning / error) and a **category**, colour-coded, with a refresh
  control. The runtime forwards its warnings and errors (and, with verbose
  logging on, everything) to the service so both surfaces read the same, and its
  console output is now badged and categorized to match.
- A **scenario test harness** (`scripts/harness.sh`) runs the injected runtime
  against a mock of the Steam UI in a headless browser, covering the native tab,
  coexistence mirroring, the sole-host path and the fallback panel without a
  device.
- The service now **obtains the Deck Shelves bundle on its own** when it is not
  already present: it uses a local copy if there is one, otherwise copies the
  built bundle from an installed plugin loader, otherwise downloads the newest
  release from the Deck Shelves project — so a machine with no local bundle can
  still bring Deck Shelves up. `SHELVES_PRERELEASE=1` widens the download to
  pre-release versions (the pre-release channel).
- As the sole host (no other loader present), the injected runtime discovers
  Steam's own React, ReactDOM and jsx-runtime and exposes them to the bundle, so
  the plugin resolves React from this host rather than from a loader's globals.
- The service can now host the Deck Shelves data backend directly: it starts
  the backend as a supervised child process, restarts it if it crashes, and
  forwards data requests (settings, backups, and the rest) from the Steam
  interface to it. Backend log lines show up in the service's own log.
- The hosting environment is fully self-contained and neutral: the backend
  gets a settings directory (outside any other tool's file tree), a log
  channel, and a simple request/response protocol — nothing more is emulated
  or provided. New settings: `SHELVES_BACKEND_DIR` (enables hosting),
  `SHELVES_PYTHON`, `SHELVES_SETTINGS_DIR`, `SHELVES_BACKEND_RUNNER_PATH`.
- A new `getBackendStatus` request reports whether backend hosting is
  configured and the process is alive.
- An example backend (`examples/backend/`) exercises the whole pipeline
  end to end without any external project.
- Coexistence with another installed host: the service now respects the
  renderer's single-owner claim and stands down instead of loading the plugin
  twice. `SHELVES_FORCE_OWNER=shelveshub` claims ownership explicitly, and the
  other side yields — settings are only ever written by one host at a time.
- A backend payload placed at `backend/` next to the binary is detected and
  hosted automatically — no configuration needed. Installers copy that payload
  when the package carries one.
- Experimental native Quick Access tab, off by default (`SHELVES_NATIVE_QAM=1`
  to try it): enabling it no longer requires editing the injected runtime, a
  trip breaker auto-disables the feature after a failed attempt instead of
  ever crash-looping the Steam interface, and the on-screen overlay always
  remains as the fallback.
- New setting `SHELVES_OWNER_SETTLE_SECS` (default `0`): while the renderer is
  unclaimed, the service waits up to this many seconds for another host to claim
  it before hosting it itself. A sole host leaves it at `0` (immediate); running
  alongside another host, set it (for example `25`) so a fast injection cycle
  never starts hosting ahead of the other host's pending claim.
- Initial ShelvesHub scaffolding.
- Installers for Linux, macOS, and Windows.
- Integrated Rust logger.
  
### Changed
- Alongside another host, the service now adds its own Quick Access tab by
  injecting only its runtime — never taking over hosting or loading the plugin
  bundle — so its tab appears next to the other host's without disturbing it.
  Previously it stood down entirely when another host owned the renderer.
- The host's Quick Access tab now shows reliably alongside another host even when
  it is added after the menu has already mounted — previously it could stay hidden
  until the menu was reopened. A related fix makes the host read the live UI's
  current render tree instead of a stale back-buffer.
- Updated dependencies, including the WebSocket client used for the DevTools
  connection.
- Added a project lint and formatting configuration, enforced the same way in
  CI and locally.
- The release workflow now marks SemVer pre-release tags (e.g. `v1.2.3-beta.1`)
  as GitHub pre-releases, keeping them off the stable channel.
- Modularized the CDP client and the injection loop into focused submodules
  (`src/cdp/`, `src/loader/`).
- The request server now answers each connection on its own thread, so a slow
  data request can no longer delay health checks.
- Long request bodies are truncated in the log.
- The loader now actually loads Deck Shelves into Steam. It finds the running
  Steam interface, injects the Deck Shelves bundle, and re-injects on its own if
  Steam restarts — previously this was just a stub that did nothing.
- A new developer tool, `shelves-devtools`, to inspect, inject and debug the
  Steam interface from the terminal. It runs on Linux, macOS and Windows, and
  can talk to a Steam Deck remotely over SSH.
- A local test mode so you can see everything working without a Steam Deck:
  `scripts/local-debug.sh` / `scripts/local-debug.ps1` launch a normal browser,
  load an example Deck Shelves panel, and verify it end to end.
- Scripts to install and run the loader straight on a Steam Deck over SSH, plus
  a debugging guide (`docs/debugging.md`).
- One `pnpm` workflow for everything: a single `pnpm setup` installs the whole
  toolchain on macOS via Homebrew, and `pnpm` tasks build, run, test, debug
  locally, and deploy to a Steam Deck.
- Deck Shelves can add its own panel and icon to the Steam Quick Access Menu
  through a host runtime the loader injects. Validated on a Steam Deck: this
  host's own menu tab opens the Deck Shelves editor directly — no intermediate
  list — carrying the plugin's icon and a header for its settings and about
  actions. It coexists with another installed host: both tabs are usable at once
  and edit the same settings, and the plugin's wide side panel opens from
  whichever tab is on screen. The bundle fills this host's tab through a
  host-selection-neutral surface (`window.__SHELVES_QAM__`) that never disturbs
  which host owns the home, and queues its panel if the tab arrives first. An
  on-screen overlay remains as the fallback where the native tab is unavailable.
- The loader now answers a host-API version handshake: the bundle can ask which
  HostApi version the loader speaks (`getHostApiVersion`) before relying on host
  features, and can report when it has finished starting up (`bundleReady`).
- Safety check: the loader refuses to inject an empty bundle, logging a clear
  message instead of silently marking a no-op as loaded.
- The bundle and the loader now talk over HTTP, and the "is Deck Shelves
  loaded?" check reports the real status instead of a fixed answer.
- The loader now injects into Steam's main app context (`SharedJSContext`)
  instead of the Big Picture wrapper window — verified on a real Steam Deck,
  where it correctly detects the Steam UI.

### Fixed
- The tree-patching the host lends to the plugin now preserves each component's
  shape — memoized and forwarded components are wrapped in kind rather than
  flattened to a plain function. A wrong wrapper could throw during a render and
  blank the home; the home now renders reliably while the plugin's patches (such
  as replacing the native recents row) still apply.
- In standalone mode the card context menu now opens from the on-screen action
  buttons, and the platform's React handles are published so the plugin's menu
  and modal code find them.
