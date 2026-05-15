# Using Shelves Loader

Shelves Loader runs as a background service and injects the Deck Shelves bundle into the Steam Big Picture UI. Below are platform-specific install and usage notes.

---

## SteamOS / Steam Deck (primary target)

### One-click

1. Download `shelves-loader.desktop` from the [latest release](https://github.com/santojon/Shelves-Loader/releases/latest).
2. In Desktop Mode, double-click the file. A terminal opens and runs the installer automatically.
3. The installer downloads the package, installs to `~/.local/share/shelves-loader`, and registers a user-level systemd service. No sudo required.

### From package

```bash
# Extract shelves-loader-steamos.tar.gz, then:
bash installer/install.sh
```

**Service commands:**

```bash
systemctl --user status shelves-loader
systemctl --user restart shelves-loader
systemctl --user stop shelves-loader
```

---

## Linux (generic)

### From package

```bash
# Extract shelves-loader-linux.tar.gz, then:
sudo bash installer/install.sh
```

Installs to `/opt/shelves-loader` and registers a system-level `shelves-loader.service`.

**Service commands:**

```bash
systemctl status shelves-loader
sudo systemctl restart shelves-loader
```

---

## macOS

### One-click

1. Download `install-mac.command` from the latest release.
2. Double-click it in Finder. On first run, right-click → Open to bypass Gatekeeper.
3. A Terminal window opens, downloads the package, installs to `/usr/local/shelves-loader`, and loads a launchd service.

### From package

```bash
# Extract shelves-loader-macos.tar.gz, then:
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
3. The installer downloads the package, copies to `C:\Program Files\Shelves-Loader`, and registers a Task Scheduler entry that starts the loader at boot.

### From package

```powershell
# Extract shelves-loader-windows.zip, then (as Administrator):
.\installer\install.ps1
```

**Verify service:**

```powershell
Get-ScheduledTask -TaskName ShelvesLoader
```

---

## Bundle

The `bundle/index.js` slot is populated by the Deck Shelves release pipeline. On a fresh loader install it contains a placeholder; the Deck Shelves installer replaces it with the real bundle. If you are setting up manually, copy the built Deck Shelves bundle to `<install_dir>/bundle/index.js`.

## RPC server

The loader exposes a local JSON-RPC endpoint at `127.0.0.1:60123`. You can probe it directly:

```bash
echo '{"method":"ping"}' | nc 127.0.0.1 60123
# → {"ok":true,"result":"pong"}

echo '{"method":"getVersion"}' | nc 127.0.0.1 60123
# → {"ok":true,"result":"0.1.0"}
```
