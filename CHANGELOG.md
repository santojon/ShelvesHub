# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]
### Added
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
### Changed
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
- Deck Shelves can now add its own panel with an icon to the Steam Quick Access
  Menu, the way the bundle wants — the loader injects a host runtime that
  provides this. The panel and icon work today as an on-screen overlay
  (verified locally); the deeper, native Steam-menu integration is scaffolded
  and pending validation on a real device.

- The loader now answers a host-API version handshake: the bundle can ask which
  HostApi version the loader speaks (`getHostApiVersion`) before relying on host
  features, and can report when it has finished starting up (`bundleReady`).
- Safety check: the loader refuses to inject an empty bundle, logging a clear
  message instead of silently marking a no-op as loaded.

### Changed
- The bundle and the loader now talk over HTTP, and the "is Deck Shelves
  loaded?" check reports the real status instead of a fixed answer.
- The loader now injects into Steam's main app context (`SharedJSContext`)
  instead of the Big Picture wrapper window — verified on a real Steam Deck,
  where it correctly detects the Steam UI.

## [0.1.0] - 2026-05-13
### Added
- Initial ShelvesHub scaffolding
- Installers for Linux, macOS, and Windows
- Integrated Rust logger
