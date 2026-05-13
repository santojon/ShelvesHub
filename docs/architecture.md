# Shelves Loader — Architecture

Shelves Loader is a small cross-platform service that injects the Deck Shelves
bundle into the Steam Big Picture UI. It provides the runtime host APIs the
bundle calls into, and manages the injection lifecycle across Linux/SteamOS,
macOS, and Windows.

---

## High-level diagram

```
Steam Big Picture (CEF renderer)
  └─ bundle/index.js   ←── injected by the loader
       └─ Deck Shelves bundle
            └─ calls window.__SHELVES_HOST__ (HostApi)
                          │
                          │ TCP JSON-RPC  127.0.0.1:57381
                          ▼
                 Shelves Loader (Rust process)
                   ├─ main.rs      — entry point, spawns RPC thread
                   ├─ loader.rs    — injection loop (30s interval)
                   ├─ rpc.rs       — TCP JSON-RPC server
                   └─ logger.rs    — structured logging
```

The bundle receives the `HostApi` object as `window.__SHELVES_HOST__` at
startup. It uses that object to register mount/unmount hooks, invoke host
methods, and manage routes. UI components and all rendering logic live entirely
inside the bundle.

---

## Components

### Loader (`src/loader.rs`)

Polls every 30 seconds to check whether the Deck Shelves bundle is already
active in the Steam renderer. If not, it runs the injection command. The
injection mechanism is currently a placeholder; it will be replaced with a
proper CEF/WebSocket probe.

Key constant: `BUNDLE_PATH = /opt/shelves-loader/bundle/index.js`.

### RPC server (`src/rpc.rs`)

Blocking TCP server on `127.0.0.1:57381`. Speaks newline-delimited JSON (one
request → one response per connection). Registered methods:

| Method | Result |
|---|---|
| `ping` | `"pong"` |
| `getVersion` | Loader semver from `Cargo.toml` |
| `isInjected` | `false` (stub — not yet implemented) |

The TypeScript-side `ShelvesHostApi.rpc.call()` wraps this in a `fetch`
POST so the bundle never manages raw sockets.

### Logger (`src/logger.rs`)

Structured log lines: `[LEVEL] [timestamp] [subsystem] message`. Levels: INFO,
WARNING, ERROR, DEBUG. Used by all Rust modules.

### Runtime — HostApi (`src/runtime/host/`)

TypeScript definition of the contract between the host process and the bundle.

| File | Purpose |
|---|---|
| `contract.ts` | `HostApi` interface + `HOST_API_VERSION = "1.0.0"` |
| `shelves.ts` | `ShelvesHostApi` — concrete implementation; RPC delegates to the Rust server |
| `index.ts` | Barrel re-export |

See [docs/host-api.md](./host-api.md) for the full contract reference.

### Bundle (`bundle/index.js`)

Placeholder. In production this is the built Deck Shelves bundle — placed here
by the Deck Shelves release pipeline. The loader reads from `BUNDLE_PATH`; the
bundle content is owned by the Deck Shelves repository.

---

## Cross-platform service management

| Platform | Mechanism | Unit file |
|---|---|---|
| Linux / SteamOS | systemd | `installer/Linux/shelves-loader.service` |
| macOS | launchd | `installer/macOS/com.shelves.loader.plist` |
| Windows | Task Scheduler | `installer/Windows/install.ps1` |

All three start the compiled `loader` binary, restart on failure, and run as
the current user so they share the Steam session.

---

## Pending work (Shelves Loader mode)

- [ ] Replace the `is_injected()` placeholder with a real CEF probe
- [ ] Replace the `inject_bundle_file` shell call with the actual WebSocket
      injection mechanism into the Steam renderer
- [ ] Implement `ShelvesHostApi.lifecycle.*`
- [ ] Implement `ShelvesHostApi.routes.*` (Steam-side route registration)
- [ ] Implement `ShelvesHostApi.notifications.*`
- [ ] Implement `ShelvesHostApi.platform.navigateToApp`
