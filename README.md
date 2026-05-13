# Shelves Loader

Shelves Loader is a small cross-platform service that injects the Deck Shelves bundle into the Steam Big Picture environment. It provides native installers and a lightweight runtime integration for Linux/SteamOS, macOS, and Windows.

## Key Features
- Native installers for Linux, SteamOS, macOS, and Windows
- Cross-platform runtime integration
- Detailed logging to help diagnose installation and injection problems

## Repository Layout
- `src/` — Core Rust service and logging components
- `installer/` — Platform installation scripts and service manifests
- `bundle/` — The inject-able Deck Shelves bundle to be deployed by the loader
- `docs/` — Documentation and guides

## Quick Start
### Linux / SteamOS
1. Run the installer script:
```bash
./installer/Linux/install.sh
```

2. Start and check the service:
```bash
systemctl start shelves-loader
systemctl status shelves-loader
```

### macOS
1. Install the service with the installer script:
```bash
./installer/macOS/install_mac.sh
```

2. Verify the service:
```bash
launchctl list | grep shelves
```

### Windows
1. Run the PowerShell installer:
```powershell
./installer/Windows/install.ps1
```

2. Confirm the loader is scheduled via Task Scheduler.

## Contribution and Governance
Please see `CONTRIBUTING.md` for development guidelines and `CODE_OF_CONDUCT.md` for community expectations.

## Security
Report security issues via `SECURITY.md`.

## Releases
Releases are handled by the repository CI when a tag matching `v*.*.*` is pushed — see `.github/workflows/release.yml`.

## License
This project is released under the terms found in the `LICENSE` file.
