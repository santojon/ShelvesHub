# Using Shelves Loader

Shelves Loader automates injection of the Deck Shelves bundle into Steam Big Picture. Below are platform-specific usage notes.

## Linux / SteamOS
1. Run the installer script:
```bash
./installer/Linux/install.sh
```
2. Start and check the service:
```bash
systemctl start shelves-loader
systemctl status shelves-loader
```

## macOS
1. Install the service with the provided script:
```bash
./installer/macOS/install_mac.sh
```
2. Verify the service registration:
```bash
launchctl list | grep shelves
```

## Windows
1. Run the installer PowerShell:
```powershell
./installer/Windows/install.ps1
```
2. Check Task Scheduler to ensure loader runs on boot.

## Bundle deployment
Place the inject-able bundle into the `bundle/` directory before installing.
