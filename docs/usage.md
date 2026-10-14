# Using ShelvesHub

*[Leia em português](pt-BR/usage.md)*

ShelvesHub runs as a background service and injects the Deck Shelves bundle into the Steam Big Picture UI. Below are platform-specific install and usage notes.

---

## SteamOS / Steam Deck (primary target)

### One-click

1. Download `shelveshub.desktop` from the [latest release](https://github.com/santojon/ShelvesHub/releases/latest).
2. In Desktop Mode, double-click the file (if the system asks whether to run a downloaded
   launcher, choose *Continue*). A terminal opens, fetches the installer script and runs it;
   it stays open until you press Enter, so any message can be read.
3. The installer downloads the package, installs to `~/.local/share/shelveshub`, and registers a user-level systemd service. No sudo required.

The same installer runs from a terminal without the launcher:
`bash <(curl -sL https://github.com/santojon/ShelvesHub/releases/latest/download/install-steamos.sh)`.

### From package

```bash
# Extract shelveshub-steamos.tar.gz (x86_64) or shelveshub-steamos-aarch64.tar.gz
# (ARM64), then:
bash installer/install.sh
```

**Service commands:**

```bash
systemctl --user status shelveshub
systemctl --user restart shelveshub
systemctl --user stop shelveshub
```

---

## Linux (generic)

### From package

```bash
# Extract shelveshub-linux.tar.gz (x86_64) or shelveshub-linux-aarch64.tar.gz
# (ARM64), then (as your normal user, NOT with sudo):
bash installer/install.sh
```

Installs to `~/.local/share/shelveshub` and registers a user-level `shelveshub.service`.

**Service commands:**

```bash
systemctl --user status shelveshub
systemctl --user restart shelveshub
```

---

## macOS

### One-click

1. Download `install-mac.command` from the latest release.
2. Double-click it in Finder. On first run, right-click → Open to bypass Gatekeeper.
3. A Terminal window opens, downloads the package, installs to `~/.local/share/shelveshub`, and loads a launchd service.

### From package

```bash
# Extract shelveshub-macos.tar.gz, then:
bash installer/install_mac.sh
```

**Verify service:**

```bash
launchctl list | grep shelves
```

---

## Windows

### One-click

1. Download `install-windows.bat` from the latest release.
2. Double-click it and accept the UAC prompt (admin required).
3. The installer downloads the package, copies to `%LOCALAPPDATA%\ShelvesHub` (per-user, no admin needed), and registers a per-user Task Scheduler entry that starts it at logon. The task starts the service through a hidden PowerShell, so no console window appears; the service log is `%LOCALAPPDATA%\ShelvesHub\logs\out.log` (the previous file is kept as `out.log.1`).

### From package

```powershell
# Extract shelveshub-windows.zip, then (as Administrator):
.\installer\install.ps1
```

**Verify service:**

```powershell
Get-ScheduledTask -TaskName ShelvesHub
```

---

## Bundle

The package ships `bundle/index.js` as a placeholder; the daemon fills the slot itself on its first start — it copies a loader-managed Deck Shelves if one is on the machine, otherwise it downloads the newest Deck Shelves release — and keeps it current with automatic updates on (on by default). If you are setting up manually, copy a built Deck Shelves bundle (the `index.iife.js` artifact) to `<install_dir>/bundle/index.js`.

## RPC server

The daemon exposes a local HTTP JSON-RPC endpoint at `127.0.0.1:60123` (`rpc_host` / `rpc_port` in the config file; per service, `SHELVES_RPC_HOST` / `SHELVES_RPC_PORT`, or `SHELVES_RPC_ADDR` when those two are unset). Every request carries the JSON content type and the per-boot bearer token the daemon writes next to its install (`~/.local/share/shelveshub/.rpc-token`; `%LOCALAPPDATA%\shelveshub\.rpc-token` on Windows):

```bash
TOKEN="$(cat ~/.local/share/shelveshub/.rpc-token)"
curl -s http://127.0.0.1:60123/ -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"method":"ping"}'
# → {"ok":true,"result":"pong"}

curl -s http://127.0.0.1:60123/ -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"method":"getVersion"}'
# → {"ok":true,"result":"<installed version>"}
```

The method list and the wire format are in [host-api.md](host-api.md#rpc-wire-format).
