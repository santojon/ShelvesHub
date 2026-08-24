# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added
- When Deck Shelves cannot be loaded, the host's own tab now shows a **ShelvesHub
  panel** with recovery actions instead of an empty tab; the home always loads
  regardless. Its text is **localized** from per-locale files under `runtime/i18n/`
  (the service inlines them at injection time).
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
- Initial ShelvesHub scaffolding.
- Installers for Linux, macOS, and Windows.
- Integrated Rust logger.
  
### Changed
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
