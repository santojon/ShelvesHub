# Troubleshooting

*[Leia em português](pt-BR/troubleshooting.md)*

Most issues come down to a **port conflict**, **another host on the same machine**,
or a **collapsed Steam UI**. Nearly all are fixable from the config file —
`shelveshub.config.json`, installed next to the binary — without a rebuild.

## The config file

Precedence per setting is **environment variable > config file > built-in default**.
Edit `shelveshub.config.json` (or point `SHELVES_CONFIG_FILE` at another path), then
restart the ShelvesHub service. Every key is documented inline in the file; remove a
key to fall back to its default.

## Port conflicts

### The RPC port (60123) is already in use

Symptom: ShelvesHub exits right after it starts and the log shows `Failed to bind the control
endpoint 127.0.0.1:60123: … Another ShelvesHub is probably running (or another process holds
the port), so this one exits.` A hub that cannot open its control endpoint never injects —
nothing could be saved through it — and the one already holding the port keeps running with its
own token. The usual cause is a second ShelvesHub, one started by hand or a second install: the
copy that starts second is the one that exits. When that copy is the service, systemd (every 10 s)
and launchd keep restarting it and the line repeats until the port is free. Stop the other
ShelvesHub; when something else holds the port, find it (`ss -ltnp | grep 60123` on Linux,
`lsof -iTCP:60123 -sTCP:LISTEN` on macOS, `netstat -ano | findstr :60123` on Windows) and stop
it, or pick a free port and restart the service:

```json
{ "rpc_port": 60125 }
```

The injected runtime uses the same port automatically (the daemon stamps it in), so
you only change it in one place.

Any other error in that line comes with a hint to check `rpc_host` / `rpc_port` in
`shelveshub.config.json` instead — an `rpc_host` that is not an address of this machine, or a
port this user may not open (a port below 1024 on Linux, or one inside a range Windows reserves
for its own services); the hub exits the same way until they are fixed and the service is
started again.

### Steam's debug port (8080) is wrong or unreachable

Symptom: `Injection cycle skipped: … Connection refused` on `127.0.0.1:8080` (logged
once; it stays the loader's last line until the endpoint answers). Steam's CEF
remote-debugging endpoint isn't reachable there. First
make sure it is enabled — `~/.steam/steam/.cef-enable-remote-debugging` exists and
Steam was fully restarted afterwards. If it listens on a different port, set it:

```json
{ "cef_port": 8081 }
```

You can also move the host with `cef_host` if debugging a remote endpoint.

## Another host on the same machine (coexistence)

ShelvesHub coexists with another host (for example another plugin loader): it
never loads the plugin twice and adds only its own tab. When the loader's own Deck
Shelves is older than 3.2.0 (the store's 2.0.0 among them) it never claims the renderer,
so nothing tells the hub it is there — ShelvesHub still sees it in the loader's plugin
list and keeps to its tab (the log says `Coexisting with "plugin loader (Deck Shelves
<version>, no ownership claim …)"`); 3.2.x and 3.3.0 claim it without a version stamp, so
the tab shows an amber warning and `—` as the version. Update Deck Shelves in the loader
(3.3.1 or newer) to get the editor inside the hub's tab and settings shared between the
two; the community troubleshooting page carries a matrix of every version and setting. The loader's plugin store can lag far behind the
releases (it listed 2.0.0 while 3.3.4 was current), so install the release zip from the Deck
Shelves releases page when the store offers nothing newer than 3.3.0. Hosting a second copy
next to a loader-managed
one would mount the home twice and collapse the Steam interface, so the hub never does
it unless `force_owner` is set on purpose. Two knobs:

- **It hijacked a plugin the other host was about to load.** Give the other host
  time to claim the renderer first:

  ```json
  { "owner_settle_secs": 25 }
  ```

- **You want Deck Shelves to run on ShelvesHub next to the loader** (cooperative
  ownership):

  ```json
  { "force_owner": true }
  ```

  Beside a loader the hub injects its runtime and publishes its host, so the Deck
  Shelves the loader launched binds to ShelvesHub while the loader keeps the renderer
  and its other plugins; the hub still never loads a second copy of the plugin. It does **not** take the renderer away from a host that already owns it
  — that is not supported and could destabilise the interface. Without any loader on
  the machine the option does nothing useful: the loop waits at least 20 s (or
  `owner_settle_secs`, whichever is longer) for a loader to appear before hosting the
  renderer as a sole host anyway, so a machine where ShelvesHub is the only host keeps
  `force_owner` off and sets `owner_settle_secs` to `0` for an instant boot. Changing
  this setting takes effect after a restart (use **Restart to apply** on the hub page,
  which restarts the daemon and Steam together).

- **You want the hub to run and update Deck Shelves next to the loader** (`force_owner` +
  `coop_bundle`):

  ```json
  { "force_owner": true, "coop_bundle": true }
  ```

  The hub leaves a standing offer in the renderer (the bundle version it carries); a Deck
  Shelves 3.4.0 or newer in the loader stands down on it at the next Steam start — its entry in
  the loader's panel then just points at the ShelvesHub tab — and the hub hosts its own copy
  when its first injection lands (about 25 s after a restart on a Steam Deck; keep
  `interval_secs` at 45 or below). If the hub's copy never arrives within a minute, the
  loader's copy boots itself and the hub withholds the offer for a day (the log says so) — only
  when that happened while the current hub process was running: a hub that was stopped,
  restarted or updated offers again at once;
  turning the option off withdraws the offer on the next tick. A loader copy newer than the
  hub's makes the hub check for an update at once, so the next start's offer carries the newer
  version. An older Deck Shelves ignores the offer and keeps today's coexistence.

- **The loader has other plugins but no Deck Shelves.** Nothing to wait for: the hub hosts its
  own copy beside the loader right away (the log says `Plugin loader present without Deck
  Shelves of its own — hosting our copy beside it.`), in either `force_owner` state. Install
  Deck Shelves in the loader later and the next Steam start goes back to coexistence (or to the
  cooperative bundle, if that is on).

## Black screen / collapsed Steam UI

If the Steam UI ever collapses, the daemon **pauses injection** (it never
force-restarts Steam — that makes it worse) and, by default, runs the
**per-platform official recovery** once (on a Steam Deck, restarting the Gaming
Mode session; on macOS/Windows, bringing Steam back into Big Picture). You don't
need to configure anything.

To run a **custom** command instead, set `recover_cmd` (or `SHELVES_RECOVER_CMD`):

```json
{ "recover_cmd": "systemctl --user restart steam-launcher.service" }
```

To **disable** auto-recovery (pause only, and just log the hint), set it to `off`:

```json
{ "recover_cmd": "off" }
```

## The native tab

The native Quick Access tab is controlled by `native_qam` (on in the shipped config;
`SHELVES_NATIVE_QAM=1` per service). Set it to `false` to disable it: the hub then
adds nothing to the Quick Access menu — there is no on-screen panel to fall back to,
and on a sole host the Deck Shelves panel has nowhere else to appear — so keep it on
unless the tab itself misbehaves. From the Steam debug console,
`__SHELVES_QAM__.mode()` (present in every mode, including beside a loader) answers
`native`, `native-arming`, `tripped`, or `panel` when the tab is not installed.

## Notifications

The host's notifications — Deck Shelves' toasts and ShelvesHub's own notices — go through
Steam's own notification system (Steam's toast, sound, in-game overlay, an entry in its
Notifications tab). That wraps Steam's toast renderer, so it only installs on a sole host,
on the React version it was written against, and after a pre-flight check; beside a plugin
loader the host's notices use the loader's toaster instead. The side panel beside the hub view
keeps the last notifications in its Notifications tab (the bell by the title, or Ctrl+Shift+N).
`native_notifications` (on by default; `false` in the config file,
`SHELVES_NATIVE_NOTIFICATIONS=0` per service, or the "Steam notifications" switch in the tab's
Configuration section) turns the Steam path off — then notifications only reach that tab.
When the path cannot install, the reason is in the
log (`native toasts: …`); from the Steam debug console,
`__SHELVES_HOST__.notifications.mode()` answers `active`, `pending`, `failed` or `off`. If it
ever misbehaves, turn the setting off and restart the service.

## Updates

- **The "Restart to update" button stays after turning updates off** — a
  downloaded update is already staged next to the binary and runs at the next restart whatever
  the switches say now, so its notice stays until then. Restart the service, or tap that notice
  in the tab twice (the first tap reads "Tap again to restart"), to finish it.
- **Switching the Deck Shelves pre-release channel** — the hub's switch and Deck Shelves' own
  beta switch are read at every update check, so a change applies at the next check without a
  restart.
- **The data backend after a Deck Shelves update** — when the hub hosts the backend from its own
  install folder, every Deck Shelves update brings it to the same release and restarts it (the
  log says `Backend refreshed to <tag>`); if that download fails the previous backend keeps
  running and the log says `backend not refreshed with the bundle: …`. A backend directory set
  with `SHELVES_BACKEND_DIR` is never replaced. On a first start the hub obtains the backend
  itself (from a loader-managed Deck Shelves, else the release download); the hub view's
  **Data backend** row reads on once hosting has started, and `getBackendStatus` over RPC tells
  whether it runs.

## Settings sync

The hub's own settings follow the Steam account: the update switches (automatic updates, the
per-target switches and channels, quiet updates) and the Configuration toggles (Steam
notifications, the boot animation, and the desktop-client toggle where it exists) are kept in
one document under the hub's own key in Steam's roaming storage, and settled on the first
settled tick, every 5 minutes, and right after a change in the tab. For each setting the most
recent change wins; on a tie the shared copy wins, so a device syncing for the first time takes
over what is already there — a setting you changed on that device before its first sync keeps
a fresh stamp and wins instead. Nothing device-local syncs (endpoints, paths, ownership,
intervals, the recovery command, the update bookkeeping), and only booleans for known keys are
ever applied.

- **A setting changed by itself** — another device changed it; the notification "Settings
  synced from another device" says so. Change it back and that becomes the newest value
  everywhere.
- **"Restart to apply" after a sync** — Steam notifications and the desktop-client toggle are
  read at start-up; the tab shows the synced value with its restart note until then.
- **Nothing syncs** — check the Status row "Sync settings across devices" (`off`, `—` for never,
  or an age). The log says `settings sync off: …` once when Steam's roaming storage is not
  reachable in this renderer, and `roaming copy not written` when a write did not read back.
  Steam carries the document between devices on its own schedule (sign-in, exit); a device that
  is running picks a change up within a few minutes of Steam fetching it.
- **Keep a device on its own settings** — turn "Sync settings across devices" off in that
  device's Configuration section (`setConfigSync` over RPC, `config_sync` in the hub's store);
  the switch itself never syncs.

## Deck Shelves misbehaves after ShelvesHub was removed

Deleting the install folder by hand leaves the user service behind, and a loader-managed
Deck Shelves that went through a double-mounted session may have latched its own guards.
In this order:

1. Stop the leftover service: `systemctl --user disable --now shelveshub`, then remove
   `~/.config/systemd/user/shelveshub.service` (the official uninstall script does both).
2. Update Deck Shelves in the loader to 3.3.4 or newer (the release zip, if the store lags).
3. If the home shows no shelves, open the Deck Shelves panel: a **Safe Mode** banner means
   three starts in a row never finished mounting the home — choose **Leave safe mode**. If
   its own Quick Access tab is missing, the tab's crash guard latched during the host churn;
   from Deck Shelves 3.4.0 it clears itself after a day, and it can be cleared at once by
   removing `ds-own-qam-tab-trip` from the renderer's local storage (the Safe Mode record is
   `ds-boot-outcomes-v1`).
4. Restart Steam.

## The tray icon is gone

The tray is optional and separate from the service, so the shelves keep working without it.
macOS: `launchctl kickstart -k gui/$(id -u)/com.shelveshub.tray` starts it again (its agent
relaunches it by itself after a crash; a Quit from its menu holds until the next login); if the
agent is missing, run the installer once more and opt in. Linux desktop: it is an autostart entry
(`~/.config/autostart/shelveshub-tray.desktop`), and Gaming Mode has no tray at all. Windows: the
`ShelvesHubTray` logon task (Task Scheduler → run it, or sign in again).

## Reading the log

```
journalctl --user -u shelveshub -f                  # SteamOS, desktop Linux, Linux ARM64 (systemd user service)
tail -f ~/.local/share/shelveshub/logs/out.log      # macOS (errors in error.log next to it)
%LOCALAPPDATA%\ShelvesHub\logs\out.log              # Windows (the previous file is out.log.1)
```

Every error path writes a log line, so the log is the first place to look.

The service is the same systemd user unit on every Linux — SteamOS, a desktop distribution or
an ARM64 board (the packages differ only by architecture) — so the journal line is the same
there. A daemon run by hand (`shelveshub` in a terminal, `pnpm run run`) prints to that terminal
instead. On every platform the tab's **View logs** shows the service and the injected runtime
together; the files and the journal hold the service side only.

On SteamOS / Linux the service log lives in the systemd journal, so it survives
removing the install directory: `journalctl --user -u shelveshub -n 500 --no-pager >
~/shelveshub.log` collects the last lines for a report even after an uninstall. If you
removed `~/.local/share/shelveshub` by hand instead of running the uninstaller, also
disable the leftover unit: `systemctl --user disable --now shelveshub`, then
`rm -f ~/.config/systemd/user/shelveshub.service` and `systemctl --user daemon-reload`.
