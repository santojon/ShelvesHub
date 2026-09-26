# Installing and uninstalling ShelvesHub

*[Leia em português](pt-BR/installing.md)*

Every platform has a one-click installer and a matching one-click
uninstaller, both on the same
[releases page](https://github.com/santojon/ShelvesHub/releases/latest).
After installing, **restart Steam** so ShelvesHub can catch it on launch.

**x86_64 and ARM64 (aarch64) are both supported on Linux.** The installer detects
your CPU and fetches the matching build automatically, so the steps below are the
same on an x86_64 Steam Deck or an ARM64 device — you don't pick an architecture
by hand. (On-device support on real ARM64 hardware is still being validated.)

## Steam Deck / SteamOS

**One-click:** in Desktop Mode, download `shelveshub.desktop` and double-click
it. A terminal opens and runs the installer. It installs to
`~/.local/share/shelveshub` and registers a user-level service — **no sudo
needed**.

**From the package:** extract `shelveshub-steamos.tar.gz` and run
`bash installer/install.sh`.

Service commands:

```bash
systemctl --user status shelveshub
systemctl --user restart shelveshub
```

## Linux

**From the package:** extract `shelveshub-linux.tar.gz` and run
`sudo bash installer/install.sh`. Installs to `/opt/shelveshub` as a
system-level service.

```bash
systemctl status shelveshub
sudo systemctl restart shelveshub
```

## macOS

**One-click:** download `install-mac.command`, double-click it, and on first
run right-click → **Open** to get past Gatekeeper. It installs to
`~/.local/share/shelveshub` and loads a launchd service. The macOS download is
a universal binary, so it runs natively on both Apple Silicon and Intel Macs.

Verify it's running:

```bash
launchctl list | grep shelves
```

## Windows

**One-click:** download `install-windows.bat`, double-click it, and accept the
UAC prompt (admin required). It installs to `C:\Program Files\ShelvesHub` and
registers a scheduled task that starts the service at boot.

Verify it's running:

```powershell
Get-ScheduledTask -TaskName ShelvesHub
```

## Uninstalling

Each platform ships a one-click uninstaller alongside the installer (same
download page). **Your Deck Shelves settings are kept** unless you explicitly
pass `--purge` to the uninstall script — so a plain uninstall/reinstall while
troubleshooting won't wipe your shelves.

## Troubleshooting the install

- **Nothing shows up afterwards.** Restart Steam completely — the actual
  client, not just the game. ShelvesHub injects when it catches Steam on
  launch.
- **macOS won't open the installer.** Right-click → Open the first time to
  approve it in Gatekeeper.
- More: [troubleshooting.md](troubleshooting.md).
