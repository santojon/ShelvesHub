# Changelog

*[Leia em português](docs/pt-BR/CHANGELOG.md)*

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added
- **A transparency statement on how the project is made** (`AI_USAGE.md`), the same kind of
  file the plugin and the probe toolkit carry; `NOTICE.md` gains a
  paragraph on the project site (self-contained; the optional visit counter is a hosted service,
  nothing redistributed), and the debugging page's dependency table lists every direct crate with
  its license.
- **A compatibility matrix on the community troubleshooting page.** Hub 0.6.0 beside no loader,
  a loader without Deck Shelves, and Deck Shelves 2.0.0 (the store's copy), 3.2.x, 3.3.0,
  3.3.1–3.3.4 and 3.4.0, under the defaults, `force_owner` and `force_owner` + `coop_bundle`:
  what you see, what can go wrong, the fix and its alternative, with the log lines and tab
  labels to look for (`community-docs/troubleshooting.md`, pt-BR too).
- **A lab that runs Valve's native ARM64 Steam client in a container.** `pnpm lab:steam-arm64`
  fetches the client from Valve's own client manifest (SHA-256 checked) into a named Docker
  volume, starts it headless on a virtual display with the debug port on, runs the hub's arm64
  daemon against it with a real plugin bundle and the plugin's backend, and records
  `site/reports/qa/evidence/steam-container-aarch64.json`. On an Apple silicon Mac it showed, at
  the sign-in screen and without any account: Big Picture's windows, the hub's own gamepad gate
  recognising them, the runtime and the bundle injected in about 240 ms, the plugin booting and
  the backend running. `pnpm lab:steam-arm64 login` opens a VNC session to sign in once (with a
  test account) for the library-dependent half. The QA matrix shows it as its own cell without
  letting it decide the matrix verdict, since it needs an arm64 Docker host
  (`docker/steam-arm64/`, `scripts/steam-arm64-lab.sh`, `scripts/ci/qa-matrix.mjs`).
- **One procedure for validating on a real device** (`docs/device-validation.md`, linked from the
  README and the QA lab): what to prepare, how to identify the device, how to put it in each
  ownership mode and confirm the mode, the checks with the exact commands and probes, how to
  record the result so the QA matrix attaches it, and the traps met so far.
- **Cooperative-bundle protocol, hub side (`coop_bundle`, off by default).** With a plugin loader
  present and ShelvesHub forced as the owner, the hub can now run and update its OWN copy of the
  plugin instead of leaving the loader's copy in charge: the handshake advertises `coopBundle`
  (contract 1.4.0) when the option is on; a plugin that understands it compares versions, stands
  down and publishes a hand-over signal in the renderer; the daemon's injection loop sees that
  signal on the next tick (fast cadence while waiting, bounded to two minutes so an older plugin
  that never defers does not keep the loop busy), clears any stale "host copy booted" marker and
  injects the hub's bundle on the runtime already in place — from then on the tick is "hosting",
  so the plugin auto-update, the hot-swap on a new download and the tab's plugin update rows all
  apply in cooperative mode too. A plugin that predates the protocol keeps today's behavior
  (`src/loader/mod.rs`, `src/loader/coop_safety.rs`, `runtime/shelves-host-api.js`,
  `runtime/shelves-host-qam.js`). Validated on a Steam Deck next to a plugin loader (the cold-start
  half is the next entry).
- **The cooperative bundle now engages at a cold Steam start.** The loader boots its Deck Shelves
  copy long before the hub's first injection tick (right after a restart the hub sees the usual
  transient "collapse" and waits a full interval), so the live handshake alone never reached the
  plugin in time and the hand-over never happened on a real device. The hub now leaves a standing
  offer in the renderer's storage (`shelveshub-coop-bundle`: the bundle version it carries),
  refreshed every tick while `coop_bundle` + `force_owner` are on and withdrawn once per renderer
  session when either is off (the renderer's storage outlives a Steam restart); a Deck Shelves
  that understands the offer (3.4.0 or newer) stands down on it at boot, and the
  hub hosts its own copy in the same tick it injects the runtime — on the Deck the shelves were up
  25 s after the Steam restart, one Home root, one owner. If the hub's copy never lands within 60 s
  the loader's copy boots itself and stamps the offer; the hub then withholds it for a day (one
  warning in the log) instead of repeating the wait at every start. The hub also keeps its copy
  current while the loader's newer copy still runs, so the next offer carries the newer version
  (`src/loader/mod.rs`).
- **A plugin loader without Deck Shelves of its own no longer leaves the hub idle.** Beside a
  loader that has other plugins but no Deck Shelves (nothing in its plugin list, nothing
  installed in its plugins directory), the hub used to wait the owner-settle window and then
  inject a bundle that never booted (the runtime stays tab-only next to a loader, and the bundle
  only self-starts without one). It now hosts its own copy right away on the same cooperative
  runtime the cooperative bundle uses — host published, the loader's UI borrowed, no scan —
  announcing the hand-over itself, in either `force_owner` state; hot-swap and updates work as
  when hosting alone. The log says "Plugin loader present without Deck Shelves of its own —
  hosting our copy beside it." (`src/loader/mod.rs`, `src/populate.rs`).
- **Forced ownership waits for the plugin loader before hosting.** Right after a daemon or Steam
  restart the loader's globals land a few seconds after the renderer, so the first injection tick
  under `force_owner` saw no loader and took the sole-host path (the tab read "sole" next to an
  active loader, and the loader's copy had to stand down afterwards). An unclaimed renderer under
  force now settles for up to 20 s (or the configured `owner_settle_secs`, whichever is longer)
  for a loader to appear before hosting; a machine with force on and no loader at all only pays
  that once per renderer (`src/loader/mod.rs`, unit-tested).
- **Go back to the previous version — for ShelvesHub and for Deck Shelves.** Every update now keeps
  what it replaced: the Deck Shelves bundle as a `.prev` copy beside the live one, and the ShelvesHub
  binary + injected runtime + assets as a `previous/` snapshot beside the binary. The tab's Updates
  section gains two "Go back to the previous …" rows (two-tap confirm) that restore them offline — no
  download — via the new `rollbackBundle` / `rollbackHub` RPC methods. A restored Deck Shelves is
  hot-swapped in place like an update; a restored ShelvesHub is staged like a self-update and takes
  effect on the next restart (automatic under a relaunching service manager). The release you went
  back from is **held back** from automatic updates until a newer one is published, so a rollback is
  not undone on the next check; updating by hand lifts the hold.
- **What's new, before it lands.** The periodic check now records the release notes of a pending
  ShelvesHub update (and of a held-back Deck Shelves update) and the tab shows them as a collapsed
  "What's new (vX)" section under the update status, so you can read what changes before applying.
- **Quiet updates.** A new "Wait until no game is running" switch (on by default, under Automatic
  updates) makes the periodic check hold its downloads and swaps while Steam reports a running app;
  it tries again on a later tick and the status row says "waiting until no game is running". A
  manual "Check now" still goes ahead. A held-back Deck Shelves release shows an "Update Deck
  Shelves now" button. `getConfig` reports `update_deferred`, `pending_plugin_update`,
  `pending_hub_notes`, `hub_previous_version` and `bundle_rollback_available`; `setUpdatePref`
  accepts `quiet_updates`.

- **The log viewer is now a sidecar beside the hub view.** "View logs" no longer squeezes the
  stream into a 300 px box under the actions: it widens the Quick Access menu — the same
  compositor message Steam's own friends list uses — and shows the full-height log stream beside
  the ShelvesHub view, sized from the live menu. Gamepad focus moves into it, B / the back
  control close it (the menu narrows again), and it collapses by itself when the menu hides so a
  reopened menu never comes back wide and empty. Runtime: `runtime/shelves-host-sidecar.js`.
  The panel has two tabs, **Logs** and **Notifications** (the notification center moved here
  from the hub view's body, with an unread badge); icons beside the ShelvesHub title open it on
  either tab, and it also opens without a pointer: a second D-pad right on the rightmost
  focusable of the hub view (the plugin's own gesture, read from Steam's controller input stream
  and registered only while the hub view is mounted), with D-pad left out of the panel closing
  it; on a keyboard, Ctrl+Shift+L (logs) or Ctrl+Shift+N (notifications).
  Inside the panel the bumpers move between its tabs (LB / RB); focus lands on the active tab
  when it opens. Notification rows show the sender's mark (the logo the toast was sent with, or
  the host's / Deck Shelves' default) and the per-type icon beside the title, as the Steam toasts
  do. It is sized to the menu's widened panel like the plugin's sidecar (the tab's own content
  panel never widens, which had capped it at 280 px) and fixed to the menu's viewport, anchored
  to the tab's content panel, so it no longer slides along when the gamepad focus scrolls the
  hub view's column under it.
- **Notifications go through Steam's own notification pipeline.** On a sole host the
  notifications this host shows — Deck Shelves' toasts routed through it, and now ShelvesHub's
  own — are dispatched by Steam itself, the way they are under a plugin loader: Steam's toast
  (sound, duration, position, in-game overlay), an entry in its Notifications tray, Steam's own
  toast chrome (frame, title, timestamp, body) via `runtime/shelves-host-toast.js`. The host wraps
  Steam's toast renderer for that, so it installs only on a sole host (beside a loader, the
  loader's own toaster is used for the host's notices), only on the React version it was written
  against, and only after a pre-flight run of the renderer passes. Notifications sent during the
  first seconds after a Steam start (Deck Shelves' boot notices) are held until the pipeline has
  settled. The former self-rendered toast card is gone: `native_notifications` is on by default
  (config file, `SHELVES_NATIVE_NOTIFICATIONS=0`, or the "Steam notifications" switch in the tab's
  Configuration section turn it off), and when the pipeline is off or cannot install, a
  notification only reaches the sidecar's "Notifications" tab (the last 20, newest first, a
  clear control), with the reason in the log.
- **ShelvesHub's own notifications.** The host now tells you, with its own mark, when: ShelvesHub
  came back on a new version (or back on an older one after a rollback); a ShelvesHub update was
  downloaded and waits for a restart; Deck Shelves was updated or rolled back; cooperative mode
  paused itself; the Steam interface collapsed and ShelvesHub restarted it. Queued by the service
  and worded by the runtime in the tab's language (19 locales). Each sender has its own logo in
  the same visual language: Deck Shelves' toasts carry the plugin's own coloured mark and the
  host's carry a ShelvesHub mark (books over a hub node); a sender may pass its own `logo` and a
  per-type `icon` (React elements) through `host.notifications.toast`, and `source: "hub"` marks
  a host notification. `host.notifications` gains `mode` / `list` / `unread` / `markRead` /
  `clear` / `subscribe` (host extras, not contract methods).
- **The hub's own settings sync across devices through Steam.** The daemon keeps one document
  of its own under its own key in Steam's roaming storage (`shelveshub-settings-sync-v1`, the
  storage Steam carries between the devices an account signs in on); it is the only writer, so
  no plugin release is involved. What syncs is user intent only: the update switches
  (`auto_update`, `auto_update_hub`, `hub_prerelease`, `auto_update_plugin`, `plugin_prerelease`,
  `quiet_updates`) and the Configuration toggles (`native_notifications`, `boot_movie`, and
  `desktop_ui` where a desktop client exists). Each value travels with the time it last changed
  and a round keeps, per setting, the most recent change from any device — two devices edited
  independently converge instead of overwriting each other; on an equal stamp the shared copy
  wins, so a device syncing for the first time takes over what is already there (a value it had
  set itself keeps a fresh stamp and wins instead). Device-local operation (endpoints, paths,
  ownership, intervals, the recovery command) never leaves the device, only booleans for known
  keys are ever applied, and keys a newer release adds are carried through by an older one. A
  round runs on the first settled tick, every 5 minutes, and on the tick after a local change;
  a change taken from another device is announced with a notification (with "restart to apply"
  when the daemon only reads the key at start-up — the tab then shows the synced value with its
  restart note). "Sync settings across devices" in the tab's Configuration section (on by
  default; `setConfigSync` over RPC; `config_sync` in the hub's store) turns it off per device;
  the Status section shows when the last round ran (`src/sync.rs`, unit-tested merge).
- **The reports dashboard charts much more of the project's health.** Every quality run now
  records, besides the Rust tests, clippy and the suppression baseline: `cargo fmt --check`,
  ESLint problems (by rule), the runtime harness, `cargo audit` when installed, the complexity
  debt of the shipped runtime (sum of the scores over the limit, count, worst function, top
  offenders — `scripts/ci/complexity.eslint.config.mjs`), code lines of the runtime and of the
  service, the QA matrix cells by status, locales with key parity and EN ↔ pt-BR doc pairs, and
  how long each step took; the overall PASS/FAIL now covers all six gates. The dashboard
  (`site/reports/dashboard.html`) grew matching sections: quality run and duration cards, gates
  passed per run, total duration, test counts and pass rates, lint and debt trends with
  per-rule and per-function lists, code size, docs and localization, step durations, repository
  traffic over time, a stable vs pre-release download split, results by scope and the overall
  distribution — and its platform coverage now reads the QA matrix instead of static rows.
- **A validate flow that records every gate as a step, like the plugin's.** `pnpm validate`
  (`scripts/validate.mjs`, step runner in `scripts/ci/lib/harness.mjs`) runs rustfmt, clippy,
  the Rust tests, `cargo audit` (skipped when not installed), ESLint, the runtime's complexity
  debt, JavaScript syntax, data files + localization parity, the one-click launchers, the
  shipped-text rule and the runtime harness (skipped without a browser) — `--docker` / `--qa`
  add the container harness and the QA matrix — and writes each step's status, duration and
  log tail into `site/reports/<scope>/<ts>.json` plus a page (`<ts>.html`, every step
  expandable, failed ones open) and the scope's history page; the run also carries the parsed
  signals, so one run feeds the dashboard, which gained per-step pass rates and average
  durations and links each run to its page. The **Ops · Quality reports** workflow now runs
  `pnpm validate:ci` (scope `release` on a release, else `ci`); `pnpm report` keeps recording
  the signals alone, and `scripts/ci/report.mjs --aggregate-only` regenerates pages, scope
  indexes and `runs.json` from the run files.
- **Privacy-first page counting for the project site, off until a site code is set.**
  `site/analytics.json` names a free, cookie-less counter (GoatCounter); when its code is set,
  `scripts/build-site.mjs` injects it into every page's `<head>` and a one-line notice (with
  the public stats link) into the landing and features footers in both languages — an empty
  code strips both. Nothing of this ships inside the host or the plugin.

### Changed
- **The hub view's Status readout moved into the side panel.** The Quick Access tab keeps three
  areas — Updates, Settings, Troubleshooting — and the side panel has three tabs: Notifications,
  Status and Logs, in that order (LB / RB walk them). "View status" in Troubleshooting, or
  Ctrl+Shift+T, opens it on Status; the inline readout was squeezed between the other rows
  (`runtime/shelves-host-qam.js`, `runtime/shelves-host-sidecar.js`; harness scenario
  `sole-host-status`).
- **The deploy matrix ships the plugin's release build to the loader's copy on the Deck.** It used
  to call the plugin's plain hard deploy, which installs a development bundle (slower on the device,
  easily mistaken for a regression) while the hub's own copy was already the release build
  (`scripts/deploy-matrix.sh`).
- **The macOS performance run and the `local:*` devtools tasks stay local.** Both read
  `LOCAL_CEF_HOST` / `LOCAL_CEF_PORT` (default `127.0.0.1:8080`) instead of `SHELVES_CEF_*`, which
  a `.env` may point at a Deck for the daemon — the Mac run used to poll the Deck until its timeout
  and never measured anything (`scripts/combined-host-run.sh`, `scripts/local-devtools.mjs`).
- **The screenshot set covers the side panel.** `pnpm site:shots:hub` now captures the Status,
  Logs and Notifications tabs (`hub-status.png`, `hub-logs.png`, `hub-notifications.png`; the
  notification center is cleared and two generic entries posted first, so the shot is in the
  capture language) and copes with a hub view that stayed open
  from the previous shot; the README galleries, the showcase page (rewritten for the current
  flow) and the site's gallery and features page show the new set, and the features page serves
  the Home as WebP like the landing page. The run captures the plugin's panel in English too, hands
  both UIs back to Steam's language after each shot, and no longer counts a file an earlier run
  left as a fresh capture (`scripts/deckprobe-ext/screenshots/scenarios/hub.py`,
  `docs/showcase.md`, `site/`).
- **Notification popups on a host without a plugin loader have Steam's toast plate.** In Big
  Picture on macOS, Windows or desktop Linux they were drawn without a background (logo and text
  floating over the screen): they used the template of Steam's notification list. Popups now sit
  on Steam's short-toast plate — dark background, shadow, logo, title with its icon over a
  two-line body — the way Steam's own short popups do; entries in Steam's notification list keep
  the list look (`runtime/shelves-host-toast.js`).
- **Rows that open the side panel end with a chevron.** "View status" and "View logs" in
  Troubleshooting end with a right-aligned `>` (16 px, 0.7 opacity), the same mark the plugin's
  own panel uses on its row that opens a side panel (`runtime/shelves-host-qam.js`).
- **The update banner reads "Restart to update".** The button under the title that restarts the
  service for a pending or staged ShelvesHub update no longer carries the product name or the
  version ("Restart to go back" for a staged rollback); the Updates section still shows the
  release (`runtime/i18n/*.json`).
- **Dead code removed.** An unbuilt copy of an old host contract (`src/runtime/host/`) and the
  runtime's unused all-at-once UI discovery are gone; the chunked discovery is the only one left.
- **Two new desk proofs.** `pnpm run harness:daemon` runs the real daemon against a headless
  browser and proves, without Steam, that a collapsed interface is detected, the recovery command
  runs exactly once and the recovered notice reaches the hub — plus recovery switched off and the
  start-up grace; it cannot touch a real Steam (its own config, ports and folders, and recording
  stand-ins for the platform's Steam tools). The runtime harness adds a Quick Access tab-switch
  scenario, counts its node unit checks as one more result and fails the run when they fail. CI
  runs both on Linux, on the runner and in the container.
- **The Quick Access diagnostic mode reads `panel`** (was `overlay`) when the native tab is not in
  the menu.
- **Local development:** `pnpm local:run` and `pnpm debug:local` give their daemon its own RPC port
  (60124, `SHELVES_RPC_PORT` overrides) and token file; `local:run` refuses to start while an
  installed service answers on 60123 and prints how to stop it for the session, and
  `debug:local` runs sealed in a temporary folder. `shelves-devtools` has a `--timeout` option, and
  the CDP connections give up after a bounded wait instead of the system's connect timeout.
- **Quality checks.** A release stops within seconds when the signing key is missing, before any
  build runs; the QA matrix marks a cell partial when one of its evidence files is missing (and a
  gating leg without evidence no longer reads as a pass); `pnpm validate` records the daemon
  scenario counts and refuses unknown arguments; the shipped-text check flags phase-style labels
  unless they name an Apple chip or a function key.
- **Setup commands are `pnpm run setup`, `pnpm run update` and `pnpm run run`** in the docs and
  script hints: plain `pnpm setup` / `pnpm update` are pnpm's own commands.
- **Automatic updates are on by default** in the hub's own settings, matching the installers.
- **After a Deck Shelves update the hub refreshes its Python backend from the same release** and
  restarts it, so the backend always matches the bundle; on a first start the backend is
  obtained in the background, so the control endpoint comes up at once on a slow network.
- **A release is refused when the signing key is missing**; unsigned release assets are never
  published.
- **The local RPC drops the unused `bundleReady` method and `X-DS-Req` header**; diagnostics no
  longer carry a `bundleReady` field, and `doctor` and the daemon share one list of debug ports.
- **The runtime harness** adds node-level checks and browser scenarios for the cooperative
  bundle, the locale and the configuration stepper; the container harness exercises the generic
  Linux installer end to end.
- **The daemon log records RPC method names instead of request bodies**, and the hub view's
  status and log polls are not logged; the token file is created owner-only from the start, and
  the RPC server caps header size, header count and concurrent connections.
- **Stood-down, settling and renderer-unreachable states are logged once per change**, not on
  every poll.
- **Linux release binaries are linked against an explicit glibc 2.31 floor** and each packaged
  Linux binary's architecture is checked before publishing; the legacy `shelveshub.reg` autostart
  entry no longer ships; the generic Linux service unit uses `ProtectSystem=full` so the daemon
  can write under your home directory; the Windows logon tasks start on battery, keep running
  when unplugged and have no run-time limit.
- **The self-update binary check uses its own size floor** instead of the bundle's.
- **The settled-state log lines are written once per change, not every tick.** "Bundle active in
  renderer." and "Coexisting with …" repeated on every tick — every 5 s while hosting — and buried
  the journal and the hub's own log viewer. They now appear when the state changes (and again after
  a Steam restart, a collapse, a pause or a desktop stand-down), so a day's journal reads as a
  handful of transitions (`src/loader/mod.rs`). A settings-sync round that meets a Steam restart
  now logs "round skipped … retrying" instead of "settings sync off" (`src/sync.rs`).
- **The first injection after a Steam start no longer waits a full interval.** Steam creates
  its shared context before its windows, so the first health check after a restart saw "no UI
  windows" and treated it as a collapse: it paused for a whole `interval_secs` before the first
  injection (25 s after the restart on a Deck with a 15 s interval, about 40 s with the shipped
  30 s). A renderer whose windows have never been seen is now read as booting — polled every
  2 s without counting a collapse strike, for at most 90 s — so the runtime and the bundle land
  as soon as the windows are up. A renderer that had windows and lost them is still a
  collapse, with the same recovery as before (`src/loader/mod.rs`).
- **Under the cooperative bundle, a loader copy newer than the hub's triggers an update check
  at once.** A newer loader copy ignores the stored offer, so the hub used to wait for the next
  periodic check (up to 30 min) before its copy — and the offer — caught up. It now checks right
  away, once per loader version seen, so the following Steam start already hands over
  (`src/loader/mod.rs`, `src/state.rs`).

### Fixed

- **Big Picture behind another window no longer stands the hub down.** On macOS (and any
  desktop) an occluded or minimized Big Picture window reports itself hidden, which the desktop
  gate took for the desktop client: the hub stood down (`Desktop client on screen …`), skipped
  bundle hot-swaps and polled fast until the window was in front again. The gate now asks Steam
  for its UI mode (Big Picture answers 4, the desktop client another value) and falls back to
  window visibility only on a client without that call (`src/loader/mod.rs`).
- **macOS: the menu-bar icon comes back after a crash.** The tray companion's agent now relaunches
  it when it ends unexpectedly (a Quit from its own menu still sticks until the next login), and a
  development deploy refreshes the tray binary and restarts it instead of leaving an old one
  (`installer/macOS/install_mac.sh`, `scripts/mac-deploy.sh`).
- **Windows: the service log is on disk.** `%LOCALAPPDATA%\ShelvesHub\logs\out.log`, moved to
  `out.log.1` once it passes 1 MiB, so a restart no longer takes the log with it
  (`src/logger.rs`).
- **Windows: the logon task starts the daemon through a hidden PowerShell**, so no console
  window appears at logon and closing a window can no longer end the service; the tray
  companion runs without a console (`installer/Windows/install.ps1`, `register-task.ps1`,
  `src/bin/tray.rs`).
- **Windows: "Restart service" and the restart after a self-update start the daemon through
  its logon task again** (directly when it was started by hand), so the task keeps supervising
  it. The previous `cmd` line quoted the executable in a way `cmd` does not read, so it most
  likely never started the binary (`src/populate.rs`).
- **Windows: the installers remove an old administrator-era task of the same name during the
  migration to a per-user install** (or say to run once elevated), and the setup's uninstaller
  removes the daemon's log directory (`installer/Windows/migrate.ps1`, `shelveshub.nsi`).
- **Windows: the binaries are built with a static C runtime**, so they start on a machine
  without the Visual C++ redistributable (`.cargo/config.toml`).
- **The hub view keeps a switch flipped while a refused config edit was in flight:** a refusal
  puts back only the refused row and clears the restart note only when nothing else marked it
  (`runtime/shelves-host-qam.js`).
- **`handshake()` reports the daemon's current stamp on every call** (`hostVersion`, `device`,
  `bundleVersion`, `coopBundle`), so a bundle swapped in place reports its own version
  (`runtime/shelves-host-api.js`).
- **The macOS installer app ships as `Install-ShelvesHub.app.zip`** (no space), so its
  `SHA256SUMS` line matches the published asset name (`scripts/build-mac-app.sh`,
  `.github/workflows/release.yml`).
- **Sole host: a component fake-rendered outside a React render** (the card-menu discovery)
  gets a temporary hook dispatcher on React 19 instead of failing at its first hook
  (`runtime/shelves-host-api.js`).
- **The quality-reports workflow installs rustfmt** with its toolchain for the
  `cargo fmt --check` gate (`.github/workflows/reports.yml`).
- **Docs and comments.** The architecture page names the host surface `window.__SHELVES_HOST__`
  (`runtime/shelves-host-api.js`); the handshake doc notes the per-call stamp; the
  troubleshooting pages say which Deck Shelves releases claim the renderer (3.2.0 and newer;
  the store's 2.0.0 does not) and where the Windows log is; comment drift fixed in the RPC
  server, the staged-update flag, the boot-movie config and the release workflow.
- **The hub view stays open across Quick Access tab switches.** Opened from the Deck Shelves
  editor, it used to fall back to the tab's front page when you switched to another tab and back,
  and its side-panel shortcuts (D-pad right twice at the right edge, Ctrl+Shift+L, Ctrl+Shift+N)
  stopped working until you reopened it.
- **A second ShelvesHub exits instead of running without its control port.** It logs the real
  cause — a port another program holds, an address that is not this machine's, or a port this
  user may not open — and leaves the running copy and its token untouched.
- **Downloads come only from the project's own releases.** The plugin bundle and backend are taken
  only from the Deck Shelves releases (first start, manual download, every update), and the hub's
  own package and checksum files only from the ShelvesHub releases; rolling the plugin back also
  takes its backend back to the matching release.
- **Updates.** A newer ShelvesHub release no longer cancels an update already downloaded and
  waiting for a restart; after a manual hub update the release notes shown belong to the version
  downloaded; manual plugin downloads follow the current beta channel without a restart; release
  tags whose build metadata contains a hyphen are ordered correctly.
- **First start without a backend:** the control endpoint answers at once and the first injection
  waits for the backend download, so the plugin's data calls work from its first load.
- **Turning the startup movie off** removes the hub's movie wherever an older install placed it,
  and still leaves a movie another tool linked in its place.
- **The hub view's configuration rows** ignore a press while the previous change is still being
  saved, and the automatic-updates switch shows its real default (on) while the view loads.
- **Installers.** The Windows uninstaller removes interrupted temporary files and the backend swap
  folders; the macOS, Windows and Linux install checks fail on an installer's error and never
  reach the machine's own install.
- **Settings writes no longer overwrite one another.** Edits made from the tab, by settings
  sync and by the automatic update check are serialized, each write uses a unique temporary
  file, and the configuration file keeps its key order so its comment entries stay beside their
  keys.
- **Update switches behave as you set them, without a restart.** The Deck Shelves pre-release
  channel follows the plugin's beta switch and the hub's switches at every check; turning
  automatic hub updates off no longer hides the restart notice of an update already downloaded;
  the hub self-update reports "staged" instead of downloading the same release again; undoing a
  hub update while another one is already downloaded is refused until the restart that applies
  it.
- **The cooperative bundle no longer makes an inert offer** when no release version is known,
  and the host handshake reports the bundle's embedded version when no release tag is recorded.
- **Loop details.** A Steam restart re-logs a stood-down or settling state for the new session, a
  moved debug port is followed after forced ownership has stood down, a transiently unreadable
  bundle no longer hides its version for good, and a replaced runtime or asset file that fails
  to copy leaves no temporary file behind.
- **Turning the boot animation off removes only the startup-movie files the hub placed**;
  another tool's overrides stay.
- **The host handshake says whether the hub's Quick Access tab is really present** and whether a
  hub-driven Deck Shelves update takes effect for the copy that is running (sole host, or after
  the cooperative-bundle hand-over); the hub view's interval and settle steppers stay within the
  ranges the daemon accepts, and a refused edit puts the row back.
- **Installers stop with a download error** when the package or SHA256SUMS cannot be fetched,
  instead of a checksum mismatch or an unpack error; the Windows `setup.exe` uninstaller also
  removes the configuration backup, the RPC token, a staged update, the rollback snapshot and
  its log; upgrading with `setup.exe` restarts an installed tray companion even when the tray
  option is left unticked.
- **Quality checks.** The QA matrix marks automated evidence older than 30 days as stale and no
  longer passes on it; the shipped-text check no longer scans the quality runs' own records.
- **Configuration and settings writes are safe.** The configuration file is written atomically and
  the previous version is kept as `shelveshub.config.json.bak`; a wrongly typed value in the hub's
  settings file falls back to its default instead of resetting every other preference.
- **The local RPC answers valid JSON for every error** (control characters in a message used to
  break it), **bounds configuration edits** (`interval_secs` 1–3600 s, `owner_settle_secs`
  0–300 s, refused with a clear message outside those ranges) and **keeps edits visible in the
  hub view**, with the restart note, until the daemon restarts.
- **Updates and rollbacks no longer race or regress.** Manual download, update and rollback
  actions answer "busy" while an update check is in flight; the hub self-update reports
  "current" instead of reinstalling or downgrading; a hub rollback is refused while an update is
  already staged; after a manual download the installed release tag is recorded, not the
  channel's newest.
- **A second daemon that cannot bind the RPC port no longer replaces the running one's token
  file.**
- **The injection loop.** A Steam restart during the owner-settle wait no longer lets the new
  renderer skip its settle window; the bundle boot gate keeps one poll timer per renderer (an
  overlapping re-inject could leave a timer re-running the bundle every 20 ms); the daemon's
  loader-presence probe reads the same globals as the runtime; the cooperative bundle makes an
  offer on a fresh install; the manual update check uses the loop's current settings and
  ownership; preload mode falls back to the normal loop when the runtime cannot be read; after
  forced ownership stands down, a loader copy's ownership claim no longer sends the daemon down
  the owner path.
- **Settings sync** skips a malformed roaming entry instead of treating the whole document as
  missing (which overwrote the other devices' settings), and keeps fields it does not know when
  it writes the document back.
- **`SHELVES_RPC_ADDR` is honoured again**, and the tray resolves the RPC address the way the
  daemon does (including `rpc_port` from the configuration file); every release download and
  release-API call has connect and overall time limits; `doctor` probes the configured ports and
  Python, finds Steam's directory on Windows and treats a missing service unit as a note.
- **Injected runtime.** Hidden Home sections stay pruned from gamepad navigation after an
  in-place Deck Shelves update; the hub's screens use Steam's language when the client reports
  it; routes registered through `host.routes` reach the loader's router in cooperative mode; the
  Quick Access panel no longer walks Steam's module map on every render.
- **Installers.** The Linux one-click installer downloads the package for your CPU, verifies it
  against SHA256SUMS and installs it; upgrading over a running ShelvesHub no longer fails on a
  busy or locked binary (the new file is staged and renamed into place, or the running `.exe` is
  moved aside); `--purge` removes the settings directory the install actually used and the
  generic Linux uninstaller gained `--purge`; the Windows `setup.exe` installs the boot-animation
  cuts, enables Steam's debug port and its uninstaller removes everything it laid down; the
  one-click macOS and Windows installers and `Install ShelvesHub.app` verify the download against
  SHA256SUMS; the Windows installer no longer fails when run from an extracted package.
- **Quality tooling.** The runtime harness proves the native render path and serves only its own
  files on the loopback interface; the QA matrix records each cell's gating flag, UTC
  timestamps, the evidence age and the host cell's real platform; the shipped-text check covers
  the site, installers, container files and workflows; localization parity compares key names
  (five unused strings removed from every locale); the example backend's recipe uses the bearer
  token and an allowlisted method; the Windows installer scenario fails on an installer error;
  ESLint runs on every pull request; the contract job verifies the compiled host API version.
- **Docs.** The architecture and host-contract pages describe contract 1.5.0, the native Quick
  Access tab and every RPC method, with a working curl recipe; the troubleshooting, debugging,
  QA lab and installation pages were corrected, in both languages.
- **The runtime keeps working with the daemon after the daemon alone restarts.** Every daemon
  start issues a new RPC token, and the runtime already injected into Steam kept the old one, so
  after a self-update, a rollback, a tray restart or a crash relaunch every call from the hub's
  tab and from the plugin answered 401 until Steam itself restarted (confirmed live). The daemon
  now hands the current token to an injected runtime on every tick, and the runtime reads it per
  call.
- **Installing a plugin update from the hub no longer reloads Steam's interface.** The reload
  landed while the daemon was re-injecting the new bundle — the same mid-boot pattern behind the
  2026-10-11 black screen. The daemon's file watch already hot-swaps the new bundle in place, so
  the reload is gone; the plugin closes its install dialog itself.
- **The plugin's beta-channel switch reaches the hub again.** The plugin stores its settings
  wrapped as `{state, rev, updatedAt}`; the hub read the top level, so the switch was never seen.
- **A stray argument no longer starts a second daemon.** `shelveshub --help` (or any unknown
  argument) used to start a full daemon that overwrote the running one's RPC token; it now prints
  the usage and exits.
- **Three plugin backend methods now answer under the hub:** the pre-import snapshot, the device identity probe and the settings-recovery notice were missing from the backend method allowlist, so those features failed silently ([`rpc.rs`](src/rpc.rs)).
- **The plugin's Parser categories filter works under the hub:** its new shortcut-tags method is on the backend method allowlist ([`rpc.rs`](src/rpc.rs)).
- **The deploy matrix no longer ships a stale plugin bundle when the plugin build fails.** The plugin was built inside a command substitution, so a failed `build:release` was ignored and whatever bundle sat in the plugin's `dist/` went out as if freshly built; the build now runs first, at top level, and a failure aborts the deploy (`scripts/deploy-matrix.sh`).
- **A plugin loader's Deck Shelves from before the coexistence protocol is no longer joined by a
  second copy.** Such a copy (older than 3.3.1) never claims the renderer, so after the
  owner-settle window the hub hosted its own bundle beside it — two instances mounted the home
  twice and the Steam interface collapsed into the recovery restart (reported from a Deck as
  "gaming mode crashing" right after installing). The daemon now reads the loader's plugin list,
  and when it lists Deck Shelves without an ownership claim it keeps to its tab (log:
  `Coexisting with "plugin loader (Deck Shelves <version>, no ownership claim …)"`) unless
  `force_owner` is set on purpose (`src/loader/mod.rs`, unit-tested decision). The
  troubleshooting guide gained the journal command that recovers the service log after an
  uninstall and the cleanup for an install directory removed by hand.
- **A fresh install no longer starts on a stale copy of Deck Shelves.** The repository (and so
  every package) carried a real 4.6 MB bundle from an older release under `bundle/index.js`, and
  the service keeps any real-looking bundle it finds — so a new install ran that old copy until
  the first automatic update. The package ships the small placeholder again, which the service
  replaces at start-up with a copy from an installed plugin loader or the newest release.
- **Housekeeping from a repository sweep.** Two unreferenced functions removed
  (`latest_hub_release_tag`, `may_inject`) along with the last lint suppressions (two
  `eslint-disable` lines in the harness mock, one `#[allow]` in the tray); one `now_ms()` and one
  config-file read/write pair replace five and three inline copies; `cfg_u16` no longer
  truncates an out-of-range port; the renderer's diagnostic globals are documented
  (`docs/debugging.md`); CI runs the shipped-text rule, launcher and data-file checks through
  `pnpm validate --only …`; RPC dispatch gained tests for the config editor's refusals.
- **The SteamOS / Linux one-click launchers opened a terminal that closed at once.** The
  `.desktop` files carried the whole install logic in their `Exec` line, with shell variables
  (`$T`, `$A`, `$(uname -m)`) inside the quotes. A desktop-entry launcher runs that line through
  the system shell before `bash` ever sees it, so the variables were expanded to nothing — the
  command became a bash syntax error (`case  in …`) and the window vanished before a message could
  be read ("the konsole crashes immediately"). The launchers now hand off to the standalone
  installer / the installed uninstaller with no shell expansion in the entry (same architecture
  detection, checksum and log as before, done by the script), and keep the terminal open with a
  "Press Enter to close" prompt whatever happens. CI now rejects a launcher whose `Exec` contains
  `$`, a backtick or `%`, and parses the command it hands to bash.
- **A failed automatic Deck Shelves download can no longer damage the live bundle.** The periodic
  update downloaded straight over the injected bundle and verified afterwards, so a truncated
  download or a checksum mismatch left a broken (or deleted) file in place. It now downloads to a
  temporary file, verifies size and `SHA256SUMS`, and only then swaps — the same tmp → verify →
  rename path the manual update already used (which now also runs the checksum).

## [0.5.0] - 2026-10-10

### Added
- **An optional desktop tray companion, via the same installer.** Every installer now offers an
  **off-by-default** choice (prompt / env `SHELVES_TRAY` / a `setup.exe` checkbox on Windows) to
  install a small system-tray / menu-bar app that shows whether ShelvesHub is hosting and offers
  quick actions (pause/resume, restart the service, restart the data backend). It is a separate
  binary that talks only to the daemon's local RPC — authenticated with the per-boot token the
  daemon now writes to a `0600` file — so no new network surface is opened. The uninstallers remove
  it and its autostart entry. See [docs/installation.md](docs/installation.md).
- **`shelveshub doctor` — checks your setup and offers to fix it.** Run it in a terminal to
  check the Steam CEF debug flag, the renderer debug port, whether Steam is running, and the
  background service, each with a concrete next step. `shelveshub doctor --fix` applies the one
  safe fix (creates the CEF debug flag); it exits non-zero when something is broken, so a script
  can gate on it.
- **Restart just the data backend from the tab.** When a data backend is hosted, the
  Troubleshooting section gains a "Restart backend" action that bounces only the Python backend
  (not the whole service), so a wedged backend recovers without interrupting hosting. Its log
  lines already show up in the Logs view.
- **The tab now shows who's hosting Deck Shelves.** The ShelvesHub tab's status readout
  names the current host (this host, or a plugin loader), the running Deck Shelves version,
  and warns when a loader's copy predates the coexistence protocol (so you know to update it).
- **`shelveshub status` — a one-command diagnostics report.** Run it in a terminal to
  print OS, architecture (target vs. running, so translation shows up), glibc, Python,
  and — on Linux — the device model, display connectors and whether the SteamOS session
  service is present. Handy for filing an ARM64 report without opening the interface.

### Changed
- **Cooperative mode now backs off on its own when it conflicts with a plugin loader.** If
  forcing ShelvesHub to host Deck Shelves while a loader is present keeps going wrong — the Steam
  UI collapsing, or Deck Shelves' own tab-recovery tripping over the churn — ShelvesHub stands the
  forced ownership down for the session and runs as plain coexistence instead of fighting the loader
  in a restart loop, and the status readout explains it. On by default; set `SHELVES_COOP_SAFE_MODE=0`
  (or `coop_safe_mode: false`) to keep forcing through it. In cooperative mode the plugin update
  toggles are also hidden and a hub-driven plugin update is held back (the loader owns its on-disk
  copy) so the two can't end up on different versions.
- **Automatic recovery now detects your system instead of assuming it.** On a Steam Deck
  it still restarts the Gaming Mode session; on a generic Linux without that service it
  defaults to pause-only (no futile restart). macOS and Windows are unchanged.
- **The optional boot animation matches your display.** On Linux the cut is chosen from the
  actual panel resolution (the Deck's 1280×800 vs. a 1080p screen) rather than assuming a Deck.

### Fixed
- **"Restart to apply" now always restarts.** After a ShelvesHub self-update, the restart action
  could do nothing on some setups (where the OS didn't report a service manager that relaunches
  ShelvesHub). It now restarts in every case — relaunching itself when nothing else would — so the
  new version actually takes over. The restart buttons also ask for a quick confirm (tap again)
  so a restart is never an accidental single press.

### Security
- **Downloaded Deck Shelves bundles are now integrity-checked.** When a plugin release
  publishes a `SHA256SUMS`, ShelvesHub verifies the bundle and the backend it downloads
  against it and refuses a file that doesn't match — so a corrupted or tampered download
  is rejected instead of injected.

## [0.4.1] - 2026-10-02

### Added
- **An update status line with a "Check now" button.** The ShelvesHub tab now always
  shows whether you're up to date and how long ago it last checked, and a "Check now"
  button runs a check on the spot instead of waiting for the periodic one. A small dot
  on the ShelvesHub button marks when an update is waiting.

### Fixed
- **The "update available" notice now shows up even alongside a plugin loader.** The
  update check no longer waits for the interface to settle before it runs, so a newer
  ShelvesHub is detected in cooperative setups too — not only when running on its own —
  and the tab refreshes the status while it's open.

## [0.4.0] - 2026-10-01

### Added
- **The installer can set your key options up front.** Choose cooperative hosting
  (`force_owner`), the Quick Access tab, desktop-client injection, and automatic
  updates + pre-release channels at install time — a prompt when you run the
  installer in a terminal, or `SHELVES_*` environment variables for a
  `curl | bash` install. They're seeded once and stay editable in the ShelvesHub
  tab. On Windows every path offers them: the `setup.exe` shows a "Setup options"
  page of checkboxes, and the script/zip installer prompts or reads `SHELVES_*`.

### Security
- **Self-update is now verified before it replaces anything.** The daemon checks
  the release's `SHA256SUMS` — minisign-signed with a public key baked into the
  daemon — and the downloaded archive's SHA-256 against it; a bad signature or
  hash aborts the update. Downloads now extract into a private (0700) work dir,
  and an archive with an absolute path, `..` traversal, or a symlink/device member
  is refused. With the signing key baked in, an update whose release is **missing**
  `SHA256SUMS` or its signature is now refused (fail-closed), not just one that
  fails to verify; the `SHELVES_ALLOW_UNSIGNED_UPDATE=1` escape hatch is dev-only.
- **Installers verify the download's checksum.** The SteamOS, Linux, macOS and
  Windows installers — including the one-click SteamOS/Linux desktop launchers —
  check the downloaded package against the release's `SHA256SUMS` before installing,
  so a corrupted or tampered download is caught (a mismatch aborts; a release without
  `SHA256SUMS` still installs).
- **The Linux/SteamOS installer refuses to run as root.** It installs per-user and
  must run as you to reach your Steam, so running it with `sudo` now stops with an
  explanation instead of creating a root-owned install (override for system images:
  `SHELVES_ALLOW_ROOT=1`).

### Changed
- **Black-screen recovery has a clear default and opt-out.** On a confirmed Steam UI
  collapse the host runs the per-platform official recovery by default (empty or unset
  `recover_cmd`) — restarting the Deck's Gaming Mode session, or bringing Steam back
  into Big Picture on desktop — with no setup. Set `recover_cmd` to a custom command to
  override it, or to `off` to disable auto-recovery (pause only). The docs and config
  comment that previously said "empty = pause only" were wrong and are corrected.
- **The installer app icon no longer appears on a plain white square.** The macOS
  and Windows installer icons now carry the site's dark background (with its blue
  glow); the transparent tab/favicon icons are unchanged.
- **Installing migrates an old root/system install to the per-user layout — without
  losing data.** On every platform, a prior root-level (or Windows Program Files /
  admin) install and its service are removed and replaced by the current per-user
  install. Your `shelveshub.config.json` is carried over, and if the old install kept
  your Deck Shelves settings under root, they're rescued to your account (only when
  you don't already have your own — never overwritten). Your settings live in a
  separate directory, so they're never touched otherwise. On Windows this runs from
  both the `setup.exe` and the script/zip installer (shared migration step).
- **Windows now installs per-user — no administrator rights.** ShelvesHub installs
  under `%LOCALAPPDATA%\ShelvesHub` and runs as you at logon, so it can manage its
  own bundle/backend/config, self-update, and reach your Steam. Previously it went
  to `Program Files` with a system task that often couldn't write there.
- **The shared host contract is now `1.3.0`.** The `HostApi` version reported to the
  bundle moves to `1.3.0`, documenting the route-patch surface (`routes.addPatch` /
  `removePatch` and the `RoutePatch` shape) alongside the host handshake and
  lifecycle teardown added earlier. Additive and backward-compatible — a bundle built
  against `1.2.0` runs unchanged.
- **Backend status now reports the Python interpreter.** `getBackendStatus` includes the
  interpreter name and whether it's actually runnable, so a device missing `python3` (some
  minimal ARM setups) shows up in diagnostics instead of only failing at the first data call.

### Fixed
- **A failed install no longer disappears without a trace.** The Linux, SteamOS,
  macOS **and Windows** installers now write the whole run to a log next to the install
  (`install.log`) and print a clear failure line, and the desktop launcher's pause reads
  from the terminal (with a short fallback wait) so the window doesn't vanish instantly on
  a console-first device — you can see, or afterwards read, why an install stopped.
- **Plugin updates no longer go silent under a plugin loader.** When ShelvesHub was
  forced to host over a loader (cooperative mode), Deck Shelves hid its own "update
  available" banner expecting the host to install it — but the host can't replace a
  loader-injected copy, so nothing updated. The host now reports it can self-install
  a plugin update only when it actually injects the bundle (standalone), so under any
  loader the plugin keeps showing its own update banner.
- **Windows self-update now verifies the download's CPU architecture.** A PE
  machine check (x64 vs ARM64) mirrors the existing Linux ELF check, so a
  wrong-architecture binary is rejected before it replaces the running one.
- **The compatibility version can no longer silently drift.** A release build now
  fails if the shared Deck Shelves contract is missing, instead of quietly falling
  back to an old version number.
- **Notifications now appear in standalone (no-loader) mode.** When ShelvesHub
  hosts Deck Shelves on its own, its toasts (update available, suggestions,
  settings recovery, and so on) silently did nothing, because this Steam build
  has no notification-display API. The host now renders them itself as a small
  on-screen toast. Under a plugin loader nothing changes — the loader still shows
  them.
- **The hub now applies its own update on restart.** It detected a newer release
  and showed "restart to apply", but nothing was staged, so restarting kept the
  old version. It now downloads and stages the new binary **and** its runtime
  before the notice, so a restart finishes the update — and it checks even while
  coexisting with a plugin loader.

## [0.3.0] - 2026-09-26

### Security
- **The local control RPC now requires a per-boot token and rejects untrusted
  callers.** The daemon's endpoint on `127.0.0.1` previously answered any local
  process or web page (open CORS, no auth), which could drive updates, settings
  or recovery. It now requires a random per-boot bearer token (stamped into the
  runtime over the daemon's own channel), a JSON content type, and reflects only
  the real renderer origin — never `*`. Upgrading forces one renderer reload so
  the runtime picks up the token.
- **`recover_cmd` can no longer be set over RPC.** It runs through a shell on a
  UI-collapse event, so it is now file/env-only; an empty value means "pause
  only" (no command run).
- **Plugin updates install only the Deck Shelves release bundle.** `applyUpdate`
  now accepts only a `.../santojon/Deck-Shelves/releases/download/<tag>/*.iife.js`
  URL — no arbitrary GitHub, look-alike host, or query/fragment-smuggled URL —
  since the file is injected into Steam with full access.
- **The Python-backend proxy forwards only the known Deck Shelves API methods**
  (allowlist), not arbitrary calls.
- **Request limits:** the RPC caps the request body at 2 MiB and times out slow
  connections.
- **The generic Linux service now runs as your user, not root.** It installs as a
  per-user systemd service (like SteamOS) under `~/.local/share/shelveshub` with
  light hardening, and an older system-wide root install is migrated automatically
  on the next install.

### Fixed
- **No longer hosts on the plain desktop client.** On desktop platforms the Big
  Picture window stays alive in the background after you return to the desktop,
  which made the host keep injecting there even with desktop hosting off. It now
  checks whether Big Picture is actually on screen and stands down when it isn't.
- **Fresh installs no longer "do nothing".** Every installer now enables Steam's
  debug port (the flag ShelvesHub needs to reach Steam) and clearly tells you to
  restart Steam once — previously a clean install with no prior loader just logged
  "connection refused" forever with nothing on screen.
- **Reinstalling actually takes effect now.** An upgrade-in-place restarts the
  service so the new binary runs immediately (it used to leave the old one
  running until a reboot), and there's never a second daemon fighting for the port.
- **A plugin hot-swap no longer leaves two copies owning the Home.** Before
  re-loading an updated bundle, the host tears the previous instance down first.
- **The update banner clears correctly.** Recording the installed version after a
  download stops the endless "update available"; and when the host itself is the
  one hosting Deck Shelves, the plugin defers its own banner to the host.

## [0.2.0] - 2026-09-25

### Added
- **macOS now runs on Intel Macs too.** The macOS package ships a **universal
  binary** (`lipo`-merged `arm64` + `x86_64`), so ShelvesHub runs natively on both
  Apple Silicon and Intel Macs — previously the build was Apple-Silicon-only and
  would not launch on an Intel Mac. CI verifies the shipped macOS binary is
  universal and fails the release if it isn't.
- **Optional boot animation.** A `boot_movie` toggle (off by default) installs a
  short Deck Shelves startup animation into Steam's own startup-movie slot
  (`config/uioverrides/movies/deck_startup.webm`), so the Deck UI plays it on
  launch — it uses Steam's native startup-movie feature rather than drawing an
  overlay. It is a live toggle: turning it on installs the movie immediately and
  turning it off removes it. Because the movie is only read by Steam on its next
  start, toggling it now surfaces the **Restart to apply** banner (which restarts
  Steam so the startup movie replays). Two source cuts ship — a 1280x800 16:10 cut
  for the Steam Deck's native panel and a 1080p 16:9 cut for desktop — and the
  matching one is chosen per platform. Because Steam plays a different startup-movie
  file per device, the host installs the animation (as a symlink, the way animation
  managers do, falling back to a copy) under every name the platform might use —
  `deck_startup.webm`, `oled_startup.webm`, `steam_os_startup.webm`,
  `steam_os_family_startup.webm` and `bigpicture_startup.webm` on SteamOS,
  `bigpicture_startup.webm` on desktop. Sources live under `assets/boot/`.
- **Experimental: desktop-client shelves.** A `desktop_ui` toggle (off by default,
  shown on macOS/Windows). By default the loader hosts the shelves only while the
  Steam gamepad / Big Picture UI is on screen and stands down in the plain desktop
  client (where the gamepad Home shelves read wrong and aren't reachable by
  gamepad), clearing an existing injection on the transition. Turn it on to inject
  in the desktop client too.
- **Per-platform recovery command.** When the loader detects the Steam UI has
  collapsed (a black screen), it now runs a sensible default recovery for the host —
  SteamOS restarts the Gaming Mode session, macOS/Windows bounce Steam back into
  Big Picture — instead of only logging a hint. `SHELVES_RECOVER_CMD` (or config
  `recover_cmd`) still overrides it.
- **The site now generates its release notes and feature list from the repo's
  own docs, in English and Portuguese.** `site/index.html`'s "What's New" list
  and `site/features.html`'s feature list were previously hand-written HTML
  that drifted from `RELEASE_NOTES.md`/`README.md`. A new `scripts/build-site.mjs`
  (`pnpm run build:site`, wired into the Pages deploy) now generates both from
  those files directly, in English and — when available — the pt-BR translation
  under `docs/pt-BR/`, switching live with the site's existing language toggle
  and falling back to English for anything not translated yet.
- **README, CHANGELOG, RELEASE_NOTES and every `docs/*.md` page now have a
  Brazilian-Portuguese translation** under `docs/pt-BR/`, cross-linked from
  each English original.
- **A community docs knowledge base** under `community-docs/` — plain-language,
  ready-to-post guides (getting started, installing, the Quick Access panel,
  automatic updates, coexistence with a plugin loader, the data backend, the
  boot animation, desktop shelves, and troubleshooting), each in English and
  Brazilian Portuguese, for Discussions / Discord / Reddit.
- **Linux ARM64 (aarch64) support.** ShelvesHub now builds and ships native
  ARM64 packages for SteamOS and generic Linux
  (`shelveshub-steamos-aarch64.tar.gz`, `shelveshub-linux-aarch64.tar.gz`)
  alongside the existing x86_64 packages, whose names are unchanged. The
  one-click installers and `.desktop` launchers detect the CPU (`uname -m`) and
  fetch the matching package, so the same download link works on an x86_64 Steam
  Deck or an ARM64 device. Every change is compile-gated for `aarch64` in CI, and
  a full ARM64 runtime harness can be run under emulation on demand. (Validation
  on real ARM64 hardware is still in progress, so ARM64 is treated as
  experimental until tested on-device.)

### Changed
- **Architecture-aware self-update.** The hub's self-update now picks its
  download by CPU architecture as well as OS, and verifies the downloaded
  binary's ELF machine type (`EM_X86_64` vs `EM_AARCH64`) before staging it — so
  an ARM64 install can never replace itself with an x86_64 binary, or vice-versa,
  even if a release asset is mislabeled.
- **The host's own settings store now preserves unknown keys.** If a newer
  ShelvesHub writes a setting an older build doesn't recognise, the older build no
  longer drops it when it reads and re-saves the file — so downgrading or running
  mixed versions across machines can't silently lose settings (version-skew safe).

## [0.1.0] - 2026-09-16

### Added
- A **Restart to apply** button appears at the top of the hub page after you
  change a setting that needs a restart; it restarts the daemon and Steam
  together so the new value takes effect. Translated across every shipped locale.
- Each **Configuration** field now shows a short explanatory subtext under its
  label — force ownership, owner-settle seconds, injection interval and the pause
  toggle — so the effect of each control is clear at a glance. Translated across
  every shipped locale.

### Changed
- `force_owner` no longer attempts to take the renderer from another host that
  already owns it — wrestling a live host out of the renderer it hosts is not
  supported and could destabilise the interface. It now stands down and coexists
  in that case (its tab is still added alongside), and only claims ownership when
  ShelvesHub is the sole host (where it also skips the owner-settle wait for an
  immediate boot).
- The native Quick Access tab now renders **native Steam controls** — real buttons
  and toggles with a gamepad focus ring — and carries a **tintable ShelvesHub
  icon**. Alongside another host it draws these from the host environment with no
  start-up scan, so the tab appears without disturbing the running interface.
- **Clickable installers** for macOS (an installer app) and Windows (a setup
  program), each carrying the ShelvesHub icon, alongside the existing one-click
  scripts for SteamOS, Linux, macOS and Windows.
- The host can **install a Deck Shelves update itself** — it fetches the release
  and swaps the bundle in place, then reloads — so updating no longer needs a
  manual file install.
- Every failure path in the service now writes a log line, so problems surface in
  the service log rather than failing silently.
- When Deck Shelves cannot be loaded, the host's own tab now shows a **ShelvesHub
  panel** with recovery actions instead of an empty tab; the home always loads
  regardless. Each action carries an icon, and **Automatic updates** is now a
  nested set of switches: a master toggle, then separate **ShelvesHub** and
  **Deck Shelves** switches, each with its own **pre-release channel** — where a
  lower switch stays hidden until the one above it is turned on. Their state is
  saved. The panel is also reachable from a **ShelvesHub button at the end of the
  host's own tab even while Deck Shelves is loaded**, and its text is **localized
  into 19 languages** from per-locale files under `runtime/i18n/` (the service
  inlines them at injection time).
- Running alongside another host, the host's own Quick Access tab now shows **the
  plugin's editor mirrored** into it — the plugin populates it through a
  host-neutral bridge, so one tab reaches the real editor and the other host's
  copy is left untouched.
- The host keeps its **own settings** (currently the automatic-updates preference)
  in a small store — `SHELVES_HUB_CONFIG` (default `<settings_dir>/shelveshub.json`)
  — written atomically with a rolling backup and healed from that backup if the
  file is ever missing or corrupt, so a crash or a bad shutdown never loses or
  corrupts it.
- New requests `getConfig`, `setAutoUpdate`, `setUpdatePref`, `getLogs`,
  `clearLogs` and `pushLogs` back the fallback panel's update switches and log
  view.
- **Automatic updates now actually update.** While the host is running Deck
  Shelves itself and automatic updates are on, it periodically checks the Deck
  Shelves releases for a newer version on the chosen channel, and when one is
  found it downloads it and swaps the bundle **in place — without reloading the
  whole interface**: the new bundle is applied by re-running Deck Shelves on the
  live view, so it stays current on its own and its "update available" prompt
  clears with no visible restart of the Steam UI. The same in-place swap also
  picks up a bundle replaced on disk by hand. The check is throttled, only runs
  when the host owns the bundle (never alongside another host that manages its own
  copy), and never replaces a working bundle unless a genuinely newer release is
  published.
- The host can now **update itself**. When a newer host version is available, the
  **Update ShelvesHub** action downloads the release package for this platform,
  verifies the binary, and swaps it in place; when the host runs as a managed
  service it then restarts itself to finish, otherwise it shows a localized
  **"downloaded — restart to finish"** notice. A newer version detected while
  automatic updates are on still surfaces the localized **"restart to update"**
  notice.
- The **Logs view now shows one merged stream** — the host runtime and the
  service side by side, newest first — where every line carries a **level**
  (info / warning / error) and a **category**, colour-coded, with a refresh
  control. The runtime forwards its warnings and errors (and, with verbose
  logging on, everything) to the service so both surfaces read the same, and its
  console output is now badged and categorized to match. The log view **slides in
  as a panel over the tab** and its rows are **gamepad-navigable**, with the **B
  button returning** to the panel it opened from instead of closing the tab.
- A **scenario test harness** (`scripts/harness.sh`) runs the injected runtime
  against a mock of the Steam UI in a headless browser, covering the native tab,
  coexistence mirroring, the sole-host path and the fallback panel without a
  device.
- The service **finds Steam's debug connection even if its port changes.** It
  probes the configured port first and falls back to the well-known ports, at
  start-up and again if the connection is lost for a while — so an environment
  where Steam's port differs no longer needs a manual override.
- The service now **obtains the Deck Shelves bundle on its own** when it is not
  already present: it uses a local copy if there is one, otherwise copies the
  built bundle from an installed plugin loader, otherwise downloads the newest
  release from the Deck Shelves project — so a machine with no local bundle can
  still bring Deck Shelves up. `SHELVES_PRERELEASE=1` widens the download to
  pre-release versions (the pre-release channel).
- As the sole host (no other loader present), the injected runtime discovers
  Steam's own React, ReactDOM and jsx-runtime and exposes them to the bundle, so
  the plugin resolves React from this host rather than from a loader's globals.
- The service can now host the Deck Shelves data backend directly: it starts
  the backend as a supervised child process, restarts it if it crashes, and
  forwards data requests (settings, backups, and the rest) from the Steam
  interface to it. Backend log lines show up in the service's own log.
- The hosting environment is fully self-contained and neutral: the backend
  gets a settings directory (outside any other tool's file tree), a log
  channel, and a simple request/response protocol — nothing more is emulated
  or provided. New settings: `SHELVES_BACKEND_DIR` (enables hosting),
  `SHELVES_PYTHON`, `SHELVES_SETTINGS_DIR`, `SHELVES_BACKEND_RUNNER_PATH`.
- A new `getBackendStatus` request reports whether backend hosting is
  configured and the process is alive.
- An example backend (`examples/backend/`) exercises the whole pipeline
  end to end without any external project.
- Coexistence with another installed host: the service now respects the
  renderer's single-owner claim and stands down instead of loading the plugin
  twice. `SHELVES_FORCE_OWNER=shelveshub` claims ownership explicitly, and the
  other side yields — settings are only ever written by one host at a time.
- A backend payload placed at `backend/` next to the binary is detected and
  hosted automatically — no configuration needed. Installers copy that payload
  when the package carries one.
- The native Quick Access tab is now **on by default**. It proved safe as a sole
  host through the post-start injection path (no start-up scan that could blank the
  screen), and a trip breaker still auto-disables it after any failed attempt rather
  than ever crash-looping the interface, with the on-screen overlay as the fallback.
  Set `native_qam: false` (or leave `SHELVES_NATIVE_QAM` unset and edit the config)
  to turn it off.
- **Faster start.** The service now polls on a short interval until it has hosted
  the interface, then backs off to the idle interval — so shelves appear promptly
  after the interface settles instead of waiting for the next slow cycle. As the
  sole host on macOS and Windows (where no other host can claim the interface) it
  also hosts immediately, with no settle wait.
- As the **sole host on macOS and Windows**, the service now brings up Deck Shelves
  end to end — including its data backend (wishlist, prices, launchers, device
  state) — by obtaining the backend the same way it obtains the bundle (a local
  copy, a copy from an installed host, or the released download). Without it the
  service still runs the core, local features.
- A **clickable one-click installer for Linux** (a desktop launcher that downloads
  and installs), alongside the existing SteamOS launcher.
- New setting `SHELVES_OWNER_SETTLE_SECS` (default `0`): while the renderer is
  unclaimed, the service waits up to this many seconds for another host to claim
  it before hosting it itself. A sole host leaves it at `0` (immediate); running
  alongside another host, set it (for example `25`) so a fast injection cycle
  never starts hosting ahead of the other host's pending claim.
- Initial ShelvesHub scaffolding.
- Installers for Linux, macOS, and Windows.
- Integrated Rust logger.
  
### Changed
- Alongside another host, the service now adds its own Quick Access tab by
  injecting only its runtime — never taking over hosting or loading the plugin
  bundle — so its tab appears next to the other host's without disturbing it.
  Previously it stood down entirely when another host owned the renderer.
- The host's Quick Access tab now shows reliably alongside another host even when
  it is added after the menu has already mounted — previously it could stay hidden
  until the menu was reopened. A related fix makes the host read the live UI's
  current render tree instead of a stale back-buffer.
- Updated dependencies, including the WebSocket client used for the DevTools
  connection.
- Added a project lint and formatting configuration, enforced the same way in
  CI and locally.
- The release workflow now marks SemVer pre-release tags (e.g. `v1.2.3-beta.1`)
  as GitHub pre-releases, keeping them off the stable channel.
- Modularized the CDP client and the injection loop into focused submodules
  (`src/cdp/`, `src/loader/`).
- The request server now answers each connection on its own thread, so a slow
  data request can no longer delay health checks.
- Long request bodies are truncated in the log.
- The loader now actually loads Deck Shelves into Steam. It finds the running
  Steam interface, injects the Deck Shelves bundle, and re-injects on its own if
  Steam restarts — previously this was just a stub that did nothing.
- A new developer tool, `shelves-devtools`, to inspect, inject and debug the
  Steam interface from the terminal. It runs on Linux, macOS and Windows, and
  can talk to a Steam Deck remotely over SSH.
- A local test mode so you can see everything working without a Steam Deck:
  `scripts/local-debug.sh` / `scripts/local-debug.ps1` launch a normal browser,
  load an example Deck Shelves panel, and verify it end to end.
- Scripts to install and run the loader straight on a Steam Deck over SSH, plus
  a debugging guide (`docs/debugging.md`).
- One `pnpm` workflow for everything: a single `pnpm setup` installs the whole
  toolchain on macOS via Homebrew, and `pnpm` tasks build, run, test, debug
  locally, and deploy to a Steam Deck.
- Deck Shelves can add its own panel and icon to the Steam Quick Access Menu
  through a host runtime the loader injects. Validated on a Steam Deck: this
  host's own menu tab opens the Deck Shelves editor directly — no intermediate
  list — carrying the plugin's icon and a header for its settings and about
  actions. It coexists with another installed host: both tabs are usable at once
  and edit the same settings, and the plugin's wide side panel opens from
  whichever tab is on screen. The bundle fills this host's tab through a
  host-selection-neutral surface (`window.__SHELVES_QAM__`) that never disturbs
  which host owns the home, and queues its panel if the tab arrives first. An
  on-screen overlay remains as the fallback where the native tab is unavailable.
- The loader now answers a host-API version handshake: the bundle can ask which
  HostApi version the loader speaks (`getHostApiVersion`) before relying on host
  features, and can report when it has finished starting up (`bundleReady`).
- Safety check: the loader refuses to inject an empty bundle, logging a clear
  message instead of silently marking a no-op as loaded.
- The bundle and the loader now talk over HTTP, and the "is Deck Shelves
  loaded?" check reports the real status instead of a fixed answer.
- The loader now injects into Steam's main app context (`SharedJSContext`)
  instead of the Big Picture wrapper window — verified on a real Steam Deck,
  where it correctly detects the Steam UI.

### Fixed
- On the Steam Beta client, the plugin's game context-menu additions (add to
  shelf, highlight, hide) no longer go missing when ShelvesHub is the sole host.
  A grouped-menu component the plugin needs was located by a source fragment that
  the Beta client's minifier reorders (`this.props.tone` on either side of the
  comparison), so it went unfound and the plugin's menu items silently dropped;
  the lookup now matches either ordering.
- The Configuration number steppers now move **sideways** with the gamepad
  (between − and +) instead of jumping vertically, by grouping the two buttons in
  a horizontal focus flow.
- The tree-patching the host lends to the plugin now preserves each component's
  shape — memoized and forwarded components are wrapped in kind rather than
  flattened to a plain function. A wrong wrapper could throw during a render and
  blank the home; the home now renders reliably while the plugin's patches (such
  as replacing the native recents row) still apply.
- In standalone mode the card context menu now opens from the on-screen action
  buttons, and the platform's React handles are published so the plugin's menu
  and modal code find them.
- Alongside another host, **exactly one Deck Shelves tab now appears** — the
  host's. When the host adds its own tab, Deck Shelves retracts the early tab it
  had shown on its own, and only once the host's tab has actually appeared, so
  there is never a moment with two tabs or none.
- The injection loop can no longer spin. A poll interval of `0` (from an edited
  config) previously made the loop retry with no pause, and when the Steam
  renderer was unreachable it would keep opening connections until the system ran
  out of them. The interval is now floored at one second, so the service always
  waits between attempts and stays idle when there is nothing to do.
