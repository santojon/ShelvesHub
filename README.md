# ShelvesHub

ShelvesHub is the standalone host service for [Deck Shelves](https://github.com/santojon/Deck-Shelves). It injects the Deck Shelves bundle into the Steam Big Picture UI and provides the runtime API the bundle calls into — no plugin loader required.

**Primary target:** SteamOS / Steam Deck. Also supported: Linux, macOS, Windows.

---

## How it works

The loader runs as a background service, watches for the Steam renderer, injects the Deck Shelves bundle (`bundle/index.js`) over the Chrome DevTools Protocol, and exposes a local HTTP JSON-RPC server (`127.0.0.1:60123`) the bundle uses to communicate with the host. See [docs/debugging.md](docs/debugging.md) for the `shelves-devtools` CDP tool and the local/on-Deck debug workflow.

The TypeScript `HostApi` contract (`src/runtime/host/`) defines what the loader provides to the bundle. The Rust process (`src/`) implements the service side.

---

## Installation

### SteamOS / Steam Deck (one-click)

Download `shelveshub.desktop` from the [latest release](https://github.com/santojon/ShelvesHub/releases/latest), open it in Desktop Mode, and follow the terminal prompt. Installs to `~/.local/share/shelveshub` with a user-level systemd service — no sudo required.

### Linux (from package)

Download `shelveshub-linux.tar.gz`, extract, and run:

```bash
sudo bash installer/install.sh
```

Manages a system-level `shelveshub.service` via systemd.

### macOS (one-click)

Download `install-mac.command` from the latest release and double-click it in Finder. On first run, right-click → Open to bypass Gatekeeper.

### Windows (one-click)

Download `install-windows.bat` from the latest release and double-click it. Accept the UAC prompt — the installer runs elevated automatically.

---

## Repository layout

```
src/
  main.rs                   Entry point — spawns RPC thread, starts injection loop
  loader.rs                 Injection loop (30s interval)
  rpc.rs                    TCP JSON-RPC server (127.0.0.1:60123)
  logger.rs                 Structured logging
  runtime/host/
    contract.ts             HostApi interface (version 1.0.0)
    shelves.ts              ShelvesHostApi — concrete implementation
    index.ts                Barrel export
  runtime/platform.ts       PlatformApi interface
installer/
  SteamOS/                  One-click .desktop + user systemd service
  Linux/                    System-wide install.sh + systemd service
  macOS/                    install_mac.sh + launchd plist + one-click .command
  Windows/                  install.ps1 + one-click .bat + registry file
bundle/
  index.js                  Placeholder — replaced by the Deck Shelves release bundle
docs/
  architecture.md           System design and component overview
  host-api.md               HostApi contract reference
  development.md            SSH development workflow
  usage.md                  Platform-specific usage notes
```

---

## Releases

Each release publishes 7 files:

| File | Description |
|---|---|
| `shelveshub-steamos.tar.gz` | SteamOS package (binary + installer + bundle slot) |
| `shelveshub-linux.tar.gz` | Linux package |
| `shelveshub-macos.tar.gz` | macOS package |
| `shelveshub-windows.zip` | Windows package |
| `shelveshub.desktop` | SteamOS one-click installer |
| `install-mac.command` | macOS one-click installer |
| `install-windows.bat` | Windows one-click installer |

CI builds on every PR merge; releases are tagged `v*.*.*` and trigger the release pipeline automatically.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

## Security

Report vulnerabilities via [SECURITY.md](SECURITY.md).

## License

This project is released under the terms in the [LICENSE](LICENSE) file.
