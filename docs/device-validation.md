# Device validation — the consolidated procedure

*[Leia em português](pt-BR/device-validation.md)*

One procedure for validating ShelvesHub on a real Steam device — a Steam Deck, another
SteamOS or Linux handheld, an ARM64 device, a desktop Steam on macOS or Windows — whether a
maintainer or a tester runs it. It gathers what the [QA lab](qa-lab.md) cannot prove in a
container: injection into Steam's gamepad interface, rendering, gamepad navigation, the
ownership modes next to a plugin loader, sleep and restart behaviour, recovery, updates,
settings sync. The outcome is one JSON record per device and day under
`site/reports/qa/evidence/device-<platform>-<date>.json`. The QA matrix attaches
`device-steamos-*` and `device-macos-*` records to those platforms' manual cells; no other
platform's cell takes a record yet (the prefixes live in `MANUAL` in `scripts/ci/qa-matrix.mjs`).

Everything here but a real collapse and its recovery was exercised on a Steam Deck and a Mac
(the daemon's side of a collapse has a desk proof in the QA lab's
[daemon scenarios](qa-lab.md#daemon-scenarios); a real Steam collapse is still only seen in the
field); the same steps apply to any device that runs Steam with a
Chromium debug port. Without a device, the QA lab's
[Steam ARM64 container](qa-lab.md#steam-arm64-in-a-container) runs Valve's own ARM64 client and
proves the injection path on it.

## Before you start

- **A debug port on Steam.** The installer creates `.cef-enable-remote-debugging` in Steam's
  root; Steam then listens on `127.0.0.1:8080` after a restart. From another machine, reach it
  through an SSH tunnel (`REMOTE_PORT=8080 scripts/deck-tunnel.sh` forwards local 8080 to it;
  without it the script targets the device's `DECK_CDP_PORT`, 8081 in `.env.example`) or a port
  forward on the device.
- **The device's address and credentials** in `.env` (`DECK_HOST`, `DECK_USER`,
  `DECK_SUDO_PASS`, `DECK_CDP_PORT`) — each repository reads its own `.env`: the hub's deploy and
  tunnel scripts read the hub's, the plugin's deploy script, gate and soaks read the plugin's.
  The plugin's hardware probe reads neither: export `DECK_HOST` (or `DECK_CDP_HOST`) and
  `DECK_CDP_PORT` before running it.
- **A development build of the plugin** when you want the navigation gate and the soaks: the
  performance snapshot they read is compiled out of release builds. Deploy it to the loader
  (`scripts/deploy/deploy-deck.sh` in the plugin repository) and, for the modes where the hub
  hosts its own copy, copy the same `dist/index.iife.js` over the hub's `bundle/index.js`.
- **The hub from the tree:** `pnpm deck:deploy` cross-builds the x86_64 daemon and ships it with
  the runtime to `DECK_DEPLOY_PATH` (the config only when the device has none), then restarts the
  service. The bundle it ships over the device's copy is `BUNDLE`, by default the repository's
  placeholder `bundle/index.js`, which the service replaces at start with the loader's
  `dist/index.iife.js` or a release download;
  `BUNDLE=<plugin repo>/dist/index.iife.js pnpm deck:deploy` ships the development build instead.
  `pnpm deck:deploy:hard` also restarts Steam. On the Mac, `pnpm mac:deploy` /
  `pnpm mac:deploy:hard` build natively, copy the binary, runtime and assets into
  `~/.local/share/shelveshub` (bundle and config untouched) and restart the launchd agent; `:hard`
  also restarts Steam into Big Picture.
- **A quiet device.** Every measurement below is void if someone restarts Steam, the hub or the
  loader in the middle. Record the shared context's target id (the `id` of the
  `SharedJSContext` entry in `curl -s 127.0.0.1:8080/json`, or the same request on the tunnelled
  or forwarded port from another machine) before a run and compare it afterwards; a changed id
  means the run crossed a restart.

## Step 1 — identify the device

Run and keep the output of (SteamOS / Linux; on macOS skip the `ldd` line, there is no glibc
there; on Windows run `%LOCALAPPDATA%\ShelvesHub\shelveshub.exe status --report` and read
`%LOCALAPPDATA%\ShelvesHub\logs\out.log`; after
`pnpm deck:deploy` with `DECK_DEPLOY_PATH` set, the binary is `$DECK_DEPLOY_PATH/shelveshub`):

```sh
uname -m                                     # x86_64 or aarch64 (arm64 on a Mac) — the SteamOS installer picks the asset by this
ldd ~/.local/share/shelveshub/shelveshub | grep "not found"   # must print nothing (glibc floor)
~/.local/share/shelveshub/shelveshub status --report   # the host's own JSON: versions, OS, target vs. running arch, glibc, python, device model, display connectors, SteamOS session service
~/.local/share/shelveshub/shelveshub doctor            # flag file, debug port, Steam process, daemon RPC, hub service
curl -s 127.0.0.1:8080/json | grep '"title"' # the window titles Steam exposes (see "What the hub keys off")
```

What the hub keys off: with `desktop_ui` off (the default) it injects only while the gamepad
interface is on screen — a target whose title contains "Big Picture" or starts with `MainMenu` /
`QuickAccess`, or whose URL contains `gamepad`, plus one of Steam's UI windows
(`SteamUIStore.WindowStore.SteamUIWindows`) visible, since the Big Picture target lingers hidden
after a return to the desktop client. Otherwise it stands down
(`Desktop client on screen … standing down`); the desktop client's own windows (`Steam`, the
`Supernav` and root menus) are not matched by name, they simply are not gamepad windows. A lone
`SharedJSContext` (no other page target) reads as a collapsed interface, except on a new renderer
that has not shown a window yet, which reads as Steam booting for up to 90 s. On a device whose
interface titles its windows differently, record the titles and set `desktop_ui: true` while
testing; that observation is itself a result.

The plugin's hardware probe (`scripts/deckprobe-ext/probes/hwcompat.py` in the plugin
repository) dumps `SteamClient.System.GetSystemInfo()` and decodes the packed compatibility
categories; so far only the Deck LCD value is confirmed against hardware — other device types are
left unmapped on purpose, so a dump from a new device is valuable.

## Step 2 — the install path

Install with the published one-click launcher or script for the platform, not with the
development deploy, when the point is the installer. Then check:

- the log says `Bundle active in renderer` (sole host) or `Coexisting with …` (a loader owns
  the plugin) — not the desktop stand-down;
- `getBackendStatus` over RPC reports `running: true` and `python_available: true` (its `python`
  field names the interpreter — `python3`, or `python` on Windows — which must be on the
  service's PATH);
- the plugin's Diagnostics show the CPU (on Linux the `model name` line of `/proc/cpuinfo`, which
  ARM64 kernels do not write, so the tile reads `—` there, or just the architecture where
  `uname -p` reports one; on macOS and Windows Python's processor string, which on a Mac is only
  `arm` (Apple silicon) or `i386` (Intel) — expected, not a defect);
- on the pre-release channel, a self-update exercises the binary check before the swap (on Linux
  the ELF machine must match the CPU; Windows checks the PE machine, macOS only the Mach-O magic);
- uninstall keeps the settings and `--purge` removes them (SteamOS, Linux and macOS, where
  `--purge` also deletes Steam's debug-port flag until the next install; `-Purge` on Windows
  removes the settings only) — the container leg proves the SteamOS file layout; the device
  proves the service manager.

## Step 3 — put the device in a mode

The hub has five ways of relating to a plugin loader. Each is a config state plus a Steam
restart; verify the mode over the debug port before measuring anything.

| Mode | Config | How to get there | What the renderer shows |
|---|---|---|---|
| loader only | — | stop the hub service — after a cooperative-bundle run, also clear the stored offer: restart the hub once with `coop_bundle: false` and let it tick in Big Picture before stopping it, or remove `shelveshub-coop-bundle` from the shared context's `localStorage` after stopping it (otherwise the loader's copy waits 60 s for the hub and the cooperative bundle is then held for a day) | owner is the loader's, no `__SHELVES_HOST__`, no marker, no offer |
| coexistence | `force_owner: false` | restart hub, restart Steam | owner is the loader's, `__SHELVES_QAM__` present, marker absent |
| cooperative | `force_owner: true` | restart hub, restart Steam | owner `shelveshub`, marker absent, the loader's entry renders the real editor — a boot race: the loader's copy must boot after the hub's stamp, so it may take a second restart |
| cooperative bundle | `force_owner: true`, `coop_bundle: true` | restart hub (the offer is written), restart Steam | owner `shelveshub`, marker present, `__DECK_SHELVES_HOST_BUNDLE_BOOTED__` set, the loader's entry renders the stand-in note |
| beside a loader without the plugin | either | move the plugin out of the loader's directory **and restart the loader's backend service** (its plugin list lives in memory), restart Steam | owner `shelveshub`, marker present, the loader lists no Deck Shelves |

Read the state with the devtools tool, always naming the target (on its own the tool prefers the
shared context, but a blank `SHELVES_TARGET=` loaded from `.env` — the `pnpm deck:*` and
`local:*` tasks load it — matches every target, so the first one, the Quick Access window, is
picked):

```sh
shelves-devtools --host <host> --port <port> --target SharedJSContext eval \
  '(function(){var w=window;return JSON.stringify({owner:w.__DECK_SHELVES_OWNER__||null,host:!!w.__SHELVES_HOST__,qam:!!w.__SHELVES_QAM__,marker:!!(w.__SHELVES_LOADER__&&w.__SHELVES_LOADER__.injected),booted:w.__DECK_SHELVES_HOST_BUNDLE_BOOTED__||null,instance:!!w.__DECK_SHELVES_INSTANCE__,offer:localStorage.getItem("shelveshub-coop-bundle")})})()'
shelves-devtools --host <host> --port <port> --target "Big Picture" eval \
  '(function(){return JSON.stringify({roots:document.querySelectorAll("#deck-shelves-home-root").length,shelves:document.querySelectorAll(".ds-shelf[data-shelfid]").length})})()'
```

`<host> <port>` is the device's debug port as your machine reaches it: `<device> 8081` on a Deck
that exposes its debug port on the LAN (`DECK_CDP_PORT` in `.env`), `127.0.0.1 8080` on the
device itself (the Mac included) or through `scripts/deck-tunnel.sh`.

## Step 4 — the checks

Run each in the mode it applies to; the table in `qa-lab.md` is the record's shape.

**Cold boot.** `systemctl --user restart steam-launcher.service` (or the platform's restart),
then read the hub's journal: `Steam is still bringing up its UI windows — waiting` (the boot
grace), the stamp and runtime lines, the settled line (`Bundle active` / `Coexisting with`; in
the cooperative bundle `Bundle active` follows the hand-over line `hosting our own copy` in the
same tick) and its time since the restart. The loader's plugin load order sets the rest; the
hub's own first tick lands when Steam's windows are up.

**Route away and back.** The plugin's gate drives real navigation (details → Home, library →
Home) and measures time-to-Home, selection, duplicate roots, fallback mounts and leaks. From the
plugin repository:

```sh
python3 scripts/deckprobe-ext/probes/backnav_gate.py <cycles> <shelves on the home>
```

Selection retention — and the details leg, which opens the focused card's page — needs a card
with gamepad focus before the run; after a cold boot nothing is focused and the details cycles
fall back to the library. Seed one through Steam's own focus tree from the shared context:

```js
(function(){var d=SteamUIStore.WindowStore.GamepadUIMainWindowInstance.m_BrowserWindow.document;
var card=d.querySelector(".ds-card");var root=SteamUIStore.NavigationManager.m_ActiveContext.m_LastActiveNavTree.m_Root;
function find(n){if(!n)return null;if(n.m_element===card)return n;var k=n.m_rgChildren||[];for(var i=0;i<k.length;i++){var r=find(k[i]);if(r)return r;}return null;}
var node=find(root);return node?node.BTakeFocus(0):"no node";})()
```

**Hot-swap and teardown.** `touch` the hub's bundle while the hub hosts a copy: the journal
shows `Bundle changed on disk — hot-swapping in place` on the next hosting tick (every 5 s) and
the re-host line (`Bundle injected`) one fast poll (2 s) later — roughly 2–7 s after the change,
3–5 s on the Deck and the Mac; the renderer keeps one root and one owner. While stood down
(desktop client on screen) nothing swaps — by design.

**Sleep-wake and restart soaks.** From the plugin repository:

```sh
python3 scripts/deckprobe-ext/probes/soak.py sleepwake <cycles> --sleep=<seconds> --shelves=<count>
python3 scripts/deckprobe-ext/probes/soak.py restart <cycles> --coexist --shelves=<count>
```

`--shelves` is the shelf count each cycle waits for (6 when omitted): give the Home's own count —
a higher number makes every cycle read "home never came back", a lower one passes on a partial
Home.

**Host restart.** Restart the daemon with the renderer live: the settled line is written once
for the renderer, the hosted copy stays, and the RPC token changes — every tool that talks to the
daemon must re-read `.rpc-token` (in `~/.local/share/shelveshub/`, `%LOCALAPPDATA%\shelveshub\` on
Windows, or the path in `SHELVES_RPC_TOKEN_FILE`) after a restart. The runtime already in the
renderer is not re-injected and keeps the token it was stamped with, so call the daemon from it
as well — `window.__SHELVES_HOST__.rpc.call("ping")` from the shared context while the hub hosts
or cooperates, the hub tab's own data in coexistence; a refusal (HTTP 401) until the renderer
reloads is a host defect to record.

**Rollback.** `rollbackBundle` swaps `bundle/index.js` and `.prev`; while hosting it hot-swaps
within a tick and the `bundle_hold_tag` survives `checkUpdates`. `rollbackHub` needs
`previous/` beside the binary (binary, `runtime/`, `assets/`, `VERSION`); for a drill, copy the
current set there with a `VERSION` file — the restore and the hold run for real, and so does the
restart when the daemon runs under systemd or launchd; on Windows, or with a daemon started by
hand, the binary is only staged and the hub shows its restart-to-finish notice instead.

**Settings sync.** Read the roaming document on each device:

```js
SteamClient.RoamingStorage.GetString("shelveshub-settings-sync-v1").then(function(s){return s})
```

Steam carries the document to the other device at a client start, not on every write; a round
runs every five minutes, and on the hub's next settled tick (up to 5 s while it hosts its own
copy, otherwise up to `interval_secs`, 30 s by default) after `setConfigSync` with `true` (a bare
boolean, or `{"enabled": true}` — other shapes switch the sync off). Writing the document
directly with `SetString` exercises the adopt → config → restart-note path without waiting for
Steam.

**Notifications.** `window.__SHELVES_NOTIFY__("notice_plugin_updated", {version: "x"})` from
the shared context; the text appears in the `notificationtoasts` window within a second.

**Failed hook.** Build the plugin's forced-error fixtures (`DS_QA_FORCE_HOME_CRASH=1 pnpm run
build`, `DS_QA_FORCE_QAM_ERROR=1 …`, development builds only), hot-swap the bundle in and back
out; Big Picture, the menu and the Home must stay usable, the journal must show no collapse.

**Collapse and recovery.** Closing Steam's window targets over the debug port is not a
collapse: Steam falls back to its desktop windows and the hub stands down until Big Picture is
back. A real collapse (the shared context alone) has only been seen in the field; when it
happens, the platform's default recovery runs once the collapse is confirmed: SteamOS restarts
`steam-launcher.service`, macOS quits Steam and reopens it into Big Picture, and Windows only asks
Steam to open Big Picture again (no restart). A Linux system without `steam-launcher.service`, or
any host with `recover_cmd: "off"`, only pauses and logs the manual-recovery hint. When a recovery
command was launched, the hub shows the recovered notice once its runtime is back in place.
The daemon's side of that path — the two collapse ticks, the recovery command or (with
`recover_cmd: "off"`) the pause and the hint, resuming once a window is back, the recovered
notice — is proven without a device by the QA lab's
[daemon scenarios](qa-lab.md#daemon-scenarios) (`pnpm run harness:daemon`), which close a
stand-in window under the real daemon. Whether a real Steam collapses that way and comes back
from the platform's command stays a field observation: record it when you see one.

**Legacy copy.** With `force_owner` off, delete `window.__DECK_SHELVES_OWNER__` from the shared
context: the next tick logs the pre-3.3.1 owner label and stays tab-only; put the value back
afterwards.

## Step 5 — record

Write the JSON next to the other evidence, `steps` as `pass` / `fail` / `skipped` plus free-form
`modes`, `checks` and `attribution`; `node scripts/ci/qa-matrix.mjs` attaches it to the
platform's manual cell by file-name prefix. Only `device-steamos-` (the SteamOS cell) and
`device-macos-` (the macOS cell) are mapped so far; a record under any other prefix is left out of
`matrix.json`, with no warning, until its cell in `scripts/ci/qa-matrix.mjs` gets a `files`
prefix. The record does not change the cell's status: it stays the fixed one stated there
(`manual` for those two). Attribute each difference to the **host**, the **Steam UI**, the
**plugin bundle** or an **external plugin**; the plugin's own thresholds stay with its gates.

## Traps seen so far

- With a blank `SHELVES_TARGET=` loaded from `.env` (the `pnpm deck:*` / `local:*` tasks load
  it), the devtools tool without `--target` talks to the first target, the Quick Access window,
  not the shared context. Pass `--target` every time.
- Every daemon restart rotates the RPC token.
- The plugin loader keeps its plugin list in its backend's memory: moving a plugin directory
  does nothing until that backend restarts.
- Switching Quick Access tabs from a script is unreliable; the hub's tab carries the four-rect
  icon, the loader's its own.
- The navigation gate and the soaks need a development build; the soaks need `--shelves`.
- The gate reads selection only when a card has gamepad focus before the run (after a cold boot
  nothing is focused, so seed one first); gamepad gestures that depend on the focus position
  (D-pad right twice at the edge) cannot be driven from the debug port.
- macOS has no `timeout` command.
- Steam's roaming storage reaches the other device at that device's client start, not per write.
- A run that crosses a Steam restart — the shared context's target id changed — is void.
- Valve's ARM64 client needs `lsof` (and GTK 2, the vendor-neutral EGL, VA-API and OpenAL) on the
  system: without `lsof` its interface never connects to the client process and no window is
  ever created, which the hub reads as a collapse.
