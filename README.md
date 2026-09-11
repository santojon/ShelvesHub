# ShelvesHub

<div align="center">
<p>
  <img src="assets/logo.svg" alt="ShelvesHub" width="352">
</p>

[![CI](https://github.com/santojon/ShelvesHub/actions/workflows/ci.yml/badge.svg)](https://github.com/santojon/ShelvesHub/actions/workflows/ci.yml)
[![Release](https://github.com/santojon/ShelvesHub/actions/workflows/release.yml/badge.svg)](https://github.com/santojon/ShelvesHub/actions/workflows/release.yml)
[![Tests](https://img.shields.io/badge/cargo%20test-30%20passed-brightgreen?logo=rust&logoColor=white)](src/)
[![Clippy](https://img.shields.io/badge/clippy-clean-brightgreen?logo=rust&logoColor=white)](Cargo.toml)
[![Platform](https://img.shields.io/badge/platform-SteamOS%20%C2%B7%20Linux%20%C2%B7%20macOS%20%C2%B7%20Windows-purple?logo=steamdeck&logoColor=white)](https://github.com/ValveSoftware/SteamOS)
[![Downloads](https://img.shields.io/github/downloads/santojon/ShelvesHub/total.svg?label=downloads&color=blue)](https://github.com/santojon/ShelvesHub/releases/latest)
[![GitHub release](https://img.shields.io/github/v/release/santojon/ShelvesHub?label=latest&color=blue)](https://github.com/santojon/ShelvesHub/releases/latest)
[![Forks](https://img.shields.io/github/forks/santojon/ShelvesHub?style=flat&color=blue)](https://github.com/santojon/ShelvesHub/network/members)
[![Clones](https://img.shields.io/endpoint?url=https%3A%2F%2Fsantojon.github.io%2FDeck-Shelves%2Fstats%2Fclones-shelveshub.json)](https://github.com/santojon/ShelvesHub/graphs/traffic)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

ShelvesHub is the independent host service for [Deck Shelves](https://github.com/santojon/Deck-Shelves). It injects the Deck Shelves bundle into the Steam Big Picture UI and provides the runtime API the bundle calls into — no plugin loader required.

**Primary target:** SteamOS / Steam Deck. Also supported: Linux, macOS, Windows.

---

## How it works

The loader runs as a background service, watches for the Steam renderer, injects the Deck Shelves bundle (`bundle/index.js`) over the Chrome DevTools Protocol, and exposes a local HTTP JSON-RPC server (`127.0.0.1:60123`) the bundle uses to communicate with the host. If no bundle is present, the service obtains one first — reusing a local copy, copying it from an installed plugin loader, or downloading the newest release (`SHELVES_PRERELEASE=1` opts into pre-release versions). See [docs/debugging.md](docs/debugging.md) for the `shelves-devtools` CDP tool and the local/on-Deck debug workflow.

The TypeScript `HostApi` contract (`src/runtime/host/`) defines what the loader provides to the bundle. The Rust process (`src/`) implements the service side.

It can also give Deck Shelves its own tab in the Steam Quick Access Menu, opening the editor directly (with the plugin's icon and header). Where another host such as plugin loader is installed too, the two coexist: both tabs stay usable and edit the same settings, the plugin's wide side panel opens from whichever tab is on screen, and only one host writes settings at a time.

---

## Installation

### SteamOS / Steam Deck (one-click)

Download `shelveshub.desktop` from the [latest release](https://github.com/santojon/ShelvesHub/releases/latest), open it in Desktop Mode, and follow the terminal prompt. Installs to `~/.local/share/shelveshub` with a user-level systemd service — no sudo required.

### Linux (one-click or from package)

One-click: download `shelveshub-linux.desktop` from the [latest release](https://github.com/santojon/ShelvesHub/releases/latest), open it, and follow the terminal prompt (it downloads and installs, prompting for sudo).

From the package instead: download `shelveshub-linux.tar.gz`, extract, and run:

```bash
sudo bash installer/install.sh
```

Manages a system-level `shelveshub.service` via systemd.

### macOS

Download **`Install ShelvesHub.app`** (a clickable installer app carrying the ShelvesHub icon) from the latest release and double-click it. On first run, right-click → Open to bypass Gatekeeper. A plain `install-mac.command` script is also published.

### Windows

Download **`shelveshub-setup.exe`** (a setup program carrying the ShelvesHub icon) from the latest release and run it, accepting the UAC prompt. A plain `install-windows.bat` script is also published.

---

## Uninstalling

Each uninstaller stops and removes the background service and the install directory. Your Deck Shelves settings (shared with other hosts) are kept unless you pass `--purge`. A **one-click uninstaller** is published for each platform alongside the installer (double-click, like installing) — or use the commands below.

| Platform | One-click | Or by hand |
|---|---|---|
| SteamOS / Steam Deck | `uninstall-shelveshub.desktop` | `bash ~/.local/share/shelveshub/uninstall.sh` (installed copy), or `bash uninstall.sh` from the extracted package |
| Linux | `uninstall-shelveshub-linux.desktop` | `sudo bash /opt/shelveshub/uninstall.sh` (or `sudo bash uninstall.sh` from the package) |
| macOS | `uninstall-mac.command` | `bash ~/.local/share/shelveshub/uninstall_mac.sh` — add `--purge` to also remove settings and Steam's CEF debug flag |
| Windows | `uninstall-windows.bat`, or **Settings → Apps** | run `uninstall.exe` in the install folder, or `installer\uninstall.ps1` from the package |

`--purge` (macOS/SteamOS) additionally removes the shared Deck Shelves settings and the `.cef-enable-remote-debugging` flag; restart Steam afterward so it stops exposing the debug port.

---

## Repository layout

```
src/
  main.rs                   Entry point — spawns RPC thread, starts injection loop
  loader/                   Injection loop + preload (document-start) mode
  cdp/                      Chrome DevTools Protocol client
  rpc.rs                    TCP JSON-RPC server (127.0.0.1:60123)
  populate.rs               Obtains / self-installs the Deck Shelves bundle
  backend.rs                Supervises the hosted data backend
  store.rs                  The host's own settings, atomically persisted
  logger.rs config.rs state.rs
runtime/
  shelves-host.js           The injected host runtime (installs the HostApi + native tab)
  i18n/                     Per-locale strings, inlined at injection time
  backend/                  Optional data-backend runner
installer/
  SteamOS/                  One-click .desktop + user systemd service
  Linux/                    System-wide install.sh + systemd service
  macOS/                    install_mac.sh + launchd plist + one-click .command + .app
  Windows/                  install.ps1 + one-click .bat + NSIS setup + registry file
assets/
  icon.svg tab-icon.svg     App icon + tintable tab icon
  icons/                    Generated rasters (.ico / .icns / PNGs) for the installers
shelveshub.config.json      Optional settings (RPC/CEF ports, coexistence, recovery)
bundle/
  index.js                  Placeholder — replaced by the Deck Shelves release bundle
docs/
  architecture.md           System design and component overview
  host-api.md               HostApi contract reference
  development.md            SSH development workflow
  usage.md                  Platform-specific usage notes
  debugging.md              shelves-devtools + local/on-Deck debug workflow
  troubleshooting.md        Ports, coexistence and recovery — fixes via the config file
```

Settings live in `shelveshub.config.json` next to the binary (env var > file >
default). See [docs/troubleshooting.md](docs/troubleshooting.md) for port conflicts,
coexistence with another host, and black-screen recovery.

---

## Releases

Each release publishes the per-platform packages, one-click scripts, and clickable installers:

| File | Description |
|---|---|
| `shelveshub-steamos.tar.gz` | SteamOS package (binary + installer + bundle slot) |
| `shelveshub-linux.tar.gz` | Linux package |
| `shelveshub-macos.tar.gz` | macOS package |
| `shelveshub-windows.zip` | Windows package |
| `shelveshub.desktop` | SteamOS one-click installer |
| `install-mac.command` | macOS one-click script |
| `install-windows.bat` | Windows one-click script |
| `Install ShelvesHub.app` (zipped) | macOS clickable installer app (with icon) |
| `shelveshub-setup.exe` | Windows setup program (with icon) |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

## Security

Report vulnerabilities via [SECURITY.md](SECURITY.md).

## License

This project is released under the terms in the [LICENSE](LICENSE) file.
