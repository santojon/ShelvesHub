# Changelog

*[Leia em português](docs/pt-BR/CHANGELOG.md)*

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

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
  a full ARM64 runtime harness can be run under emulation on demand. (Steam Frame
  hardware validation is still pending, so the Frame itself is treated as
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
