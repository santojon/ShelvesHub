# Shelves Loader Architecture

Shelves Loader is a small cross-platform service designed to inject the Deck Shelves bundle into the Steam Big Picture UI. It is intended to run on Linux/SteamOS, macOS, and Windows.

## Components

### Loader (Rust)
- The main component responsible for detecting the Steam environment and injecting the bundle.
- Provides logging and a small API surface for runtime coordination.

### Runtime (TypeScript)
- The runtime host contains generic integration logic used across platforms. It is structured to allow future extension (RPC, messaging, etc.).

## Cross-platform Design
- Installation and service management use `systemd` on Linux, `launchd` on macOS, and Task Scheduler on Windows.

## Folder Layout
- `src/` — Core Rust code
- `installer/` — Installation scripts and service manifests
- `bundle/` — The inject-able payload
- `docs/` — Project documentation
