# QA lab — cross-platform evidence

*[Leia em português](pt-BR/qa-lab.md)*

The QA lab is the set of checks ShelvesHub can run **without a Steam Deck**, per
platform and architecture, each leaving a structured record behind — plus the
cells only a real device can clear, listed with an honest status instead of a
guess. One command runs everything that is automatable and assembles the matrix.

What the lab proves: the host builds and installs, the service lifecycle, the
local RPC, the daemon injecting its runtime into a headless Chromium and handling a
collapsed interface (the daemon scenarios), the runtime scenarios (native tab, coexistence, sole host, cooperative ownership, fallback
panel, idle cost, the log side panel, notifications and the gamepad/keyboard
gestures) and the plugin's backend probes on each OS/arch.

What it cannot prove: the **real Steam CEF integration** — injection into the
gamepad UI, rendering, focus and gamepad navigation, black-screen behaviour. Those
need real Steam on real hardware; the matrix marks them `manual` or `blocked`.

## Running it

```sh
pnpm qa:matrix                      # amd64 + arm64 containers (Docker, QEMU for arm64) + host harness
QA_ARCHES="arm64" pnpm qa:matrix    # one architecture
QA_ARCHES="" pnpm qa:matrix         # host harness only, no Docker
```

Single legs, when you only need one record:

```sh
QA_EVIDENCE=1 PLATFORM=linux/arm64 bash scripts/harness-docker.sh   # one container run
HARNESS_JSON="site/reports/qa/evidence/scenarios-host-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m).json" pnpm harness  # the host harness (the matrix picks up files named scenarios-host-<os>-<arch>.json)
node scripts/ci/qa-matrix.mjs                                         # rebuild the matrix only
```

CI runs the amd64 container on every push and the arm64 container on manual
dispatch; both upload their evidence as a workflow artifact.

## Where the evidence lands

| File | Written by | Holds |
|---|---|---|
| `site/reports/qa/evidence/container-<arch>.json` | `docker/entrypoint.sh` | one verdict per step: runtime scenarios, install/uninstall lifecycle, daemon-injection smoke, daemon scenarios, plugin backend probes (`pass` / `fail` / `skipped`); `ts` in UTC ISO 8601 |
| `site/reports/qa/evidence/scenarios-<arch>.json`, `scenarios-host-<os>-<arch>.json` | `scripts/harness.sh` (`HARNESS_JSON`) | every scenario's verdict and its full report (host installed, owner, bridge, tab, fallback UI, errors, idle counters); `ts` in UTC ISO 8601 |
| `site/reports/qa/evidence/daemon-scenarios-<arch>.json` | `scripts/harness-daemon.sh` (`HARNESS_JSON`, in the container legs) | every daemon scenario's verdict and its report — the checks it asserted, what it read from the runtime's page and the daemon log; `ts` in UTC ISO 8601 |
| `site/reports/qa/matrix.json` | `scripts/ci/qa-matrix.mjs` | the cells below with their computed status, whether each one gates the overall verdict (`gate`), the age of its evidence (`ageDays`, and `stale` once it is older than the root's `staleDays`, 30 days — the cell's status then reads `stale`), the evidence files behind each (`missing` names a listed file that is absent; with the cell's other records present and fresh it then reads `partial` — a cell with no record at all stays `not-run`, an old one `stale`) — the host-harness cell takes its platform and architecture from its newest evidence record — and `ts` / `version` / `overall` like the quality runs in `site/reports/runs.json`; every `ts` is UTC ISO 8601 |

A step that is skipped (for example the plugin probes without a plugin checkout)
is recorded as `skipped`, never as a pass; the cell then reads `partial`.

## The matrix

Status legend: **tested** — evidence present, all green · **partial** — evidence with
a failed or skipped step, or a missing evidence file · **stale** — evidence older than 30 days
(counts like partial for the overall verdict) · **not-run** — automatable, no evidence yet
(also counts like partial once any gating cell has evidence) ·
**blocked** — needs a lab that is not available · **manual** — real hardware,
human-run.

| Platform | Arch | Kind | Covers | Status |
|---|---|---|---|---|
| Linux | x86_64 | container | build, install lifecycle, RPC, injection smoke, runtime scenarios, daemon scenarios, plugin probes | from evidence (CI on every push) |
| Linux | aarch64 | container (QEMU) | same as above, emulated | from evidence (CI on dispatch, or locally) |
| this machine | host | host harness | runtime scenarios in a headless Chromium | from evidence |
| Linux | aarch64 | Steam client container | Valve's native ARM64 Steam client, headless: boot, debug port, Big Picture windows, the daemon's gate, injection, backend and the bundle's boot; signed-in behaviour with a stored session | from evidence (`pnpm lab:steam-arm64`, arm64 Docker host) |
| SteamOS | x86_64 | device | real Steam: inject, render, gamepad, coexistence, cooperative | **manual** — Steam Deck; `shelveshub status --report` + the deploy/soak scripts |
| macOS | x86_64 / arm64 | device | sole host on this machine's Steam Big Picture | **manual** — `pnpm local:run` |
| Windows | x86_64 | VM | host, install, logon task, RPC, update, recovery | **blocked** — no VM yet; CI covers build, unit tests and installer syntax. Real Steam needs real hardware |
| Windows | aarch64 | VM | same, under emulation | **blocked** — no lab |
| Linux | aarch64 | device | install, inject, ARM backend, signed self-update, recovery on real hardware | **blocked** — needs a tester report; ARM64 stays experimental |
| Android | aarch64 | emulator | experimental track | **blocked** — not a release criterion |

`site/reports/qa/matrix.json` is the live version of this table; the fixed cells
(`manual`, `blocked`) are stated in `scripts/ci/qa-matrix.mjs` and updated by hand
when a lab comes online.

## Steam ARM64 in a container

Valve publishes a native ARM64 Linux Steam client — the one ARM handhelds and headsets run.
`pnpm lab:steam-arm64` fetches its client package from Valve's own client manifest (SHA-256
checked) into a named Docker volume, starts it headless on a virtual X display with software
rendering and the debug port on, starts the hub's arm64 daemon against it with a real plugin
bundle and the plugin's backend, and writes `evidence/steam-container-aarch64.json`. It needs an
arm64 Docker host (Apple silicon runs it natively); under emulation the client is far too slow.

What a run proves, without any account: the client boots on the image's library set (its first
start moves itself to Valve's ARM channel and downloads about 650 MB into the volume; later
starts reuse it), Big Picture's windows appear at the sign-in screen, the hub's own gamepad gate
recognises them, the daemon injects the runtime and the bundle, the plugin's instance boots and
the backend runs (`client-boot`, `inject`, `backend`, `bundle-boot`). The record also keeps the
window titles, the client build and what the client reports about the platform (device type,
CPU and GPU names). What needs a signed-in session: everything that depends on a library — the
shelves on the Home, the plugin's data calls (`login`). Sign in once with
`pnpm lab:steam-arm64 login` (a VNC server on `localhost:5900`, password `shelves` unless
`LAB_VNC_PASSWORD` says otherwise), using a test account: the hub's settings sync is switched
off in the lab, but the plugin's own sync would merge the lab's fresh settings into that
account's. The session stays in the volume and every later run goes all the way. Without it the
cell reads `partial` (a skipped step), never `tested`. The cell is on demand — it needs an arm64 Docker host — so its
status shows in the matrix without deciding the matrix's overall verdict.

The image carries what the client needs beyond a slim Debian: GTK 2 for its interface library,
the vendor-neutral EGL, VA-API and OpenAL, and `lsof` — without `lsof` the interface never
connects to the client process and no window is ever created. `STEAM_FLAGS` overrides the client
flags (by default the ones the client runs with on ARM devices), `LAB_KEEP=1` keeps Steam up
after the run for inspection over `localhost:8090`, and `LAB_DESKTOP_UI=1` lets the daemon
inject into the desktop client as well.

What it cannot prove: a GPU path, gamepad input, a device's own system image, power and sleep.
Those stay with the device cells.

## Runtime scenarios

Before the browser scenarios, `examples/harness/runtime-unit.js` evaluates the assembled runtime
in a node vm for what a page cannot show — the nav-prune re-arm across teardowns, `host.routes`
delegation, the locale pick, the capabilities in each mode, the Quick Access mode label and the
daemon's bundle boot gate (read from `src/loader/mod.rs`) — and reports as one more result,
`runtime-unit` (a failed check fails the run), skipped with a notice where node is absent. A run
reports the 18 browser scenarios below plus that result.

| Scenario | Set-up | Asserts |
|---|---|---|
| `coexist-mirror` | another loader present, its plugin registers a panel | host not published, owner stays the loader, our tab mirrors the editor |
| `coexist-fallback` | loader present, no plugin panel | our tab shows the fallback panel with plugin updates delegated to the loader |
| `sole-host` / `sole-host-mirror` / `sole-host-fallback` | no loader | host published and owned, tab present; mirrored editor or full fallback (download, update, configuration); `sole-host` also reads `nativeQam` and `selfUpdate` true and runs two teardowns, each finding the nav prune re-armed |
| `coexist-late` | the Quick Access menu mounted before the runtime | the re-point still lands the tab |
| `coexist-native` / `coexist-fallback-native` | native Steam UI components available | mirror / fallback rendered with native components, no errors |
| `coexist-idle` | combined host settled | no permanent sub-second timer, bounded observers |
| `coop-mirror` | loader present **and** ownership forced to ShelvesHub | host published, owner `shelveshub`, bridge up, editor mirrored, `selfUpdate` / `canSelfInstall` false (the loader's copy runs), routes and patches reach the loader's router hook, no errors |
| `coop-fallback` | same, no plugin panel | fallback panel with plugin updates delegated (the loader's copy runs, `selfUpdate` false), host owned |
| `coop-bundle` | loader present, ownership forced, the daemon's `coopBundle` config stamp and the loader copy's defer signal | host published, editor mirrored, `selfUpdate` / `canSelfInstall` true; false once the defer signal is cleared; true again with the host copy's boot stamp |
| `sole-host-sidecar` | sole host, hub view open | "View logs" in Troubleshooting opens the side panel (the menu widens — `QamFriendsExpanded` posted) with one log view; Back closes it (narrowed, `QamFriendsHidden` last), no errors |
| `sole-host-status` | sole host, hub view open | "View status" in Troubleshooting opens the side panel on its Status tab (the mode, host and version rows; no Status section left inline); the tabs read Notifications, Status, Logs, About; Back closes it; Ctrl+Shift+T reopens it on Status; the version footer opens About with the Ko-fi QR and both links, no errors |
| `sole-host-notify` | sole host; a toast through `host.notifications.toast` and a hub notice through `__SHELVES_NOTIFY__` | both listed, bell badge `2`, both rows in the side panel's Notifications tab (active), none inline in the hub view, `notifications.mode()` is `failed` (the mock has no Steam toast pipeline), no errors |
| `sole-host-gesture` | sole host, a hub-view row focused | the D-pad gesture (right, twice) opens the side panel on Logs; Back closes it; Ctrl+Shift+N reopens it on Notifications, no errors |
| `sole-host-locale` | sole host; the page URL carries `LANGUAGE=brazilian` like Steam's renderer URL | the hub view reads the shipped pt-BR strings (the View-logs title is `Ver logs`) |
| `sole-host-config` | sole host; eight `−` presses on the interval stepper from 30, then a `+` the RPC stub refuses, then another refused `+` answered slowly and a third `+` while that one is in flight | the RPC receives 25, 20, 15, 10, 5, 1 and nothing below the floor; a refused edit puts the row back on 1 and logs a WARN; the press made while an edit is in flight is never sent |
| `sole-host-tabswitch` | sole host with a plugin panel; the hub view opened from the editor, its side panel open | leaving the tab (Steam unmounts its content) closes the side panel and narrows the menu; coming back shows the hub view again, without the side panel, where two D-pad rights and Ctrl+Shift+L open it on Logs; after the hub view's back action, a tab switch shows the editor; a hub view that failed to render is not brought back either — the tab returns on the editor; no errors |

## Daemon scenarios

`bash scripts/harness-daemon.sh` (`pnpm run harness:daemon`) drives the real daemon, built from
this checkout, against a headless Chromium whose pages (`examples/daemon-harness/`) stand in for
Steam's: one titled `SharedJSContext`, the renderer the daemon injects into, and one standing in
for a Big Picture window. Each scenario starts its own browser profile and daemon, sealed off from
the machine: its own home, settings, hub store, token file and ports (an installed service is left
alone), a config file of its own that names the harness's recovery command (never the shipped
one, whose empty `recover_cmd` means the platform's real recovery: quit and reopen Steam), a local
bundle and an empty backend folder, so nothing is downloaded, and a target filter only its own
page matches, so a Steam running on the same machine is never touched. The first folder on the
daemon's `PATH` holds stand-ins for the tools a platform's recovery runs (`launchctl`,
`systemctl`, `open`, `osascript`, `pkill`, `killall`, `steam`) that only record their calls: a
scenario fails if the daemon made one (the read-only unit query of its Linux device probe aside).
It asserts the daemon's own log lines, in order, what reached the runtime, and that the daemon is
still running once its checks are done.

| Scenario | Set-up | Asserts |
|---|---|---|
| `recovered` | the bundle active in the shared context, then the window closes; the recovery command opens it again four seconds after its launch, while the collapse ticks on | two collapse ticks, the threshold error once, the recovery command launched once while the collapse outlasts it (collapse #3 and #4 follow the launch), injection resumed once the window is back, the recovered notice in the runtime's notification center |
| `recovery-off` | the same with `SHELVES_RECOVER_CMD=off`, the collapse held through four ticks | the threshold error and the auto-recovery-disabled hint once each and no recovery command; injection paused while collapsed, and no recovered notice even once the window is reopened by hand |
| `booting` | the shared context alone, no window yet | the daemon waits for Steam to bring up its windows: the waiting line once, no collapse, nothing injected (the page has no host runtime and no injection marker) |

It needs cargo, python3, curl and a Chromium-family browser (`BROWSER` picks one); `HEADLESS=0`
shows the browser, `DAEMON_HARNESS_CDP_PORT` / `DAEMON_HARNESS_RPC_PORT` /
`DAEMON_HARNESS_HTTP_PORT` move its ports (9555 / 60177 / 8577 by default, printed at the start)
and `HARNESS_JSON=<path>` writes a `daemon-scenarios` evidence record. `HARNESS_NO_SANDBOX=1` adds
`--no-sandbox --disable-dev-shm-usage` for containers and root. The container legs run it as one
more step and keep the record as `daemon-scenarios-<arch>.json`, attached to the container cells;
`pnpm validate` runs it on this machine. What it proves is the daemon's side of a collapse —
detection, the threshold, the command launched once, standing down and resuming, the notice;
whether a real Steam collapses that way and comes back from the platform's recovery command stays
a device observation (see [Device validation](device-validation.md)).

## Device cells — evidence template

The full procedure — how to put a device in each ownership mode, which probes to run, the
traps — is [Device validation](device-validation.md). A device run has no script to record it,
so write it down the same way every time (a comment on the release, or a file next to the
evidence):

```
date / device / OS + Steam channel
hub version · Deck Shelves version · ownership mode (sole / coexist / cooperative)
check                       result   notes
cold boot                   ok|fail  time to first usable Home
route away → back (details, library)   ok|fail  flash? selection kept?
gamepad selection retention ok|fail
hot-swap / teardown         ok|fail  one runtime left? tab count?
sleep-wake                  ok|fail
host restart                ok|fail
failed / unsupported hook   ok|fail  Steam UI still usable?
attach: `shelveshub status --report` JSON
```

Attribute each difference to **host**, **Steam UI**, **Deck Shelves bundle** or an
**external plugin** — never file every mismatch as a host regression. Performance
thresholds stay with the plugin's own gates; a Chromium or VM number is not a Steam
UI number.

A device record written as JSON with the same fields (`steps` as `pass` / `fail` /
`skipped`, plus free-form `checks` and `attribution`) and saved as
`evidence/device-<platform>-<date>.json` rides along the platform's manual cell in
`matrix.json`; the cell stays `manual` — a person ran it, no script judged it.

## Device evidence — 2026-10-12

Records: `evidence/device-steamos-2026-10-12.json` and `evidence/device-macos-2026-10-12.json`.
Hub: the 0.6.0 working tree; Deck Shelves 3.3.4 carrying the 3.4.0 cooperative changes. The
Deck ran a plugin loader with 18 plugins (a CSS theming plugin among them) in every cell but the
one that removes that plugin.

| Check | Steam Deck | macOS (sole host) |
|---|---|---|
| cold boot | loader-only +15 s · coexist +25 s · cooperative (loader copy on the hub's host) +28 s · cooperative bundle +15–26 s · beside a loader without the plugin +18 s | Big Picture back 11 s after a Steam restart |
| route away → back (5 cycles, detail and library → Home) | avg: loader-only 474 ms · coexist 494 · cooperative 396 · cooperative bundle 492; one root, no fallback mount | not run (the gate drives the loader's navigation) |
| gamepad selection retention | 5/5 in the warm session that started with a focused card, and 5/5 in the cooperative-bundle session once a card focus is seeded through Steam's nav tree (404 ms avg, zero leak deltas); nothing is focused after a cold boot, so the gate needs the seed | — |
| sidecar keyboard shortcuts | — | Ctrl+Shift+L opens, Ctrl+Shift+N and Ctrl+Shift+T switch, with real key events over CDP; the D-pad gesture needs gamepad focus on the view's rightmost control — hand check |
| hot-swap / teardown | cooperative bundle 4 s, beside-loader 3 s; one runtime, one owner | bundle rollback → hot-swap in 2 s, undo the same |
| sleep-wake | 2/2 (20 s), home back within 1.2 s of resume, hub's copy kept | — |
| host restart | daemon restarts under systemd with the renderer live; hub rollback restart in 10 s, hold kept | hub rollback restart under launchd, hold kept |
| failed / unsupported hook | the plugin's forced-crash builds (Home crash, Quick Access panel error) hot-swapped into the hub's copy and back: Big Picture, the menu and the Home stayed usable, no collapse | not run |
| settings sync | Mac → Deck adopted; the restart note on a synced `native_notifications` (direct roaming write) | Deck → Mac adopted after a Steam restart; a fresh store took the cloud on its first round |
| notifications | Steam's own toast window rendered the hub notice | the same, earlier the same day |
| leaks over the run | zero timer/observer deltas in every repeated run (loader-only, coexist, cooperative repeat at 368 ms avg, cooperative bundle, plugin absent); the single +1/+1 of the first cooperative run did not reproduce | — |
| CSS theming plugin absent | cooperative session, 5 cycles: 566 ms avg, one root, no fallback, zero leak deltas — no difference attributable to that plugin | — |

Attributed differences: the cold-start spread is Steam's boot order (shared context before
windows) plus the loader's plugin load order — the hub's first tick is now bound by the windows
coming up; the settings-sync delays and the writes that never arrived are Steam's roaming
storage (it carries the document at a client start, not for every write); the missing selection
reading after a cold boot is a gate limitation (it needs a card focused before the run, and
reads 5/5 once one is seeded through Steam's nav tree); the first cooperative run's +1 timer /
+1 observer did not reproduce in a repeat of the same mode nor in a warm cooperative-bundle run
and is not filed. Closing every Steam UI window over the debug port is not a collapse: Steam
falls back to its desktop windows, the hub's desktop gate stands down and resumes with Big
Picture — a real collapse (shared context alone) could not be produced on demand, so the
recovered notice after a real recovery stays a field observation.
