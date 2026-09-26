# Using ShelvesHub

*[Leia em português](pt-BR/usage.md)*

ShelvesHub runs as a background service and injects the Deck Shelves bundle into the Steam Big Picture UI. Below are platform-specific install and usage notes.

---

## SteamOS / Steam Deck (primary target)

### One-click

1. Download `shelveshub.desktop` from the [latest release](https://github.com/santojon/ShelvesHub/releases/latest).
2. In Desktop Mode, double-click the file. A terminal opens and runs the installer automatically.
3. The installer downloads the package, installs to `~/.local/share/shelveshub`, and registers a user-level systemd service. No sudo required.

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
# (ARM64), then:
sudo bash installer/install.sh
```

Installs to `/opt/shelveshub` and registers a system-level `shelveshub.service`.

**Service commands:**

```bash
systemctl status shelveshub
sudo systemctl restart shelveshub
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
3. The installer downloads the package, copies to `C:\Program Files\ShelvesHub`, and registers a Task Scheduler entry that starts the loader at boot.

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

The `bundle/index.js` slot is populated by the Deck Shelves release pipeline. On a fresh loader install it contains a placeholder; the Deck Shelves installer replaces it with the real bundle. If you are setting up manually, copy the built Deck Shelves bundle to `<install_dir>/bundle/index.js`.

## RPC server

The loader exposes a local HTTP JSON-RPC endpoint at `127.0.0.1:60123`. You can probe it directly:

```bash
curl -s 127.0.0.1:60123 -d '{"method":"ping"}'
# → {"ok":true,"result":"pong"}

curl -s 127.0.0.1:60123 -d '{"method":"getVersion"}'
# → {"ok":true,"result":"0.1.0"}
```
