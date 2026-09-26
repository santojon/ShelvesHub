# Release Notes

*[Leia em português](docs/pt-BR/RELEASE_NOTES.md)*

Highlights for each release, written for people using ShelvesHub. The full,
detailed list of changes lives in [CHANGELOG.md](CHANGELOG.md).

Releases are created automatically by CI when a version tag (`vMAJOR.MINOR.PATCH`)
is pushed — the notes below are picked up and published with the release.

## [Unreleased]

## [0.3.0] - 2026-09-26

- **Tighter security for the local control channel.** The background service's
  local endpoint now requires a private per-session key and only accepts requests
  from Steam itself — other local programs and web pages can no longer drive
  updates, settings or recovery through it. Upgrading applies this automatically
  (Steam reloads once so it takes effect).
- **Safer updates and backend calls.** A plugin update now installs only the
  official Deck Shelves release file — never an arbitrary link — and the data
  backend answers only the calls it is meant to.
- **The Linux service now runs as your user, not root.** It installs as a regular
  per-user background service, with your settings in the right place; an older
  root install is migrated automatically on upgrade.
- **No longer shows up on the plain desktop client.** With desktop hosting off,
  the host now correctly stands down when you leave Big Picture for the desktop,
  instead of staying active in the background there.
- **Fresh installs and reinstalls just work.** A first install enables Steam's
  debug port and tells you to restart Steam once; reinstalling or upgrading
  restarts the service so the new version runs immediately, with no leftover
  second copy fighting for the connection.
- **The update banner clears correctly** after an update completes, and a plugin
  hot-swap no longer leaves two copies of it running at once.

## [0.2.0] - 2026-09-25

- **Runs on Intel Macs now, not just Apple Silicon.** The macOS download is a
  universal build, so ShelvesHub launches natively on any Mac.
- **Optional boot animation.** Turn it on to play a short Deck Shelves startup
  animation when the Steam gamepad UI launches — it uses Steam's own startup-movie
  feature. A Deck-native 1280×800 cut and a 1080p desktop cut ship, and the right
  one is used for your device; the animation is placed under every startup-movie
  name Steam might use so it takes effect whatever your device. Toggling it shows a
  **Restart to apply** button (the movie is replayed when Steam restarts). Off by default.
- **Shelves stay in the gamepad UI (experimental desktop toggle).** On macOS and
  Windows the host now hosts your shelves only while Steam's gamepad / Big Picture
  UI is on screen, not in the plain desktop client where they don't belong. A new
  experimental toggle lets you opt back into the desktop client if you want it.
- **Automatic black-screen recovery.** If the Steam interface ever collapses, the
  host now runs a recovery step made for your system — restarting the Steam Deck's
  Gaming Mode session, or bringing Steam back into Big Picture on macOS and Windows.
- **Sturdier settings across versions.** Running different ShelvesHub versions on
  your machines no longer risks losing a setting the older one didn't know about.
- **The site now shows release notes and the full feature list in Portuguese too**,
  switching live with the existing language toggle — automatically falling back
  to English for anything not translated yet. The README, changelog and every
  guide page also now have a Brazilian-Portuguese version, linked from each
  English page.
- **Runs on Linux ARM64 (aarch64) now.** There are native ARM64 downloads for
  SteamOS and Linux, and the installer picks the right one for your device
  automatically — the x86_64 downloads are unchanged. Self-update also stays on
  your architecture, so an ARM64 machine never pulls an x86_64 build by mistake.
  (Support is still being validated on real ARM64 hardware.)

## [0.1.0] - 2026-09-16

- **Shelf actions work in the game menu on the Steam Beta.** When ShelvesHub is
  hosting on its own, the "add to shelf / highlight / hide" items now appear in a
  game's context menu on the Steam Beta client, just as they do elsewhere.
- **Clearer settings.** Each Configuration field now has a short description under
  it, in your language, and the number steppers move sideways with the gamepad
  (between − and +) instead of vertically.
- **A native tab that looks the part.** The host's Quick Access tab now renders
  real Steam buttons and toggles — with a gamepad focus ring and a ShelvesHub icon
  that tints to your theme — so it feels like the rest of the interface.
- **Click to install.** Double-click installers for macOS and Windows, each with
  the ShelvesHub icon, alongside the one-click scripts for SteamOS, Linux, macOS
  and Windows.
- **Updates itself.** When a newer ShelvesHub is available, the host can download
  and verify the new version, swap its own binary in, and restart the service to
  finish — or tell you to restart when it can't. No reinstall, no manual copying.
- **Keeps Deck Shelves current on its own.** With automatic updates on, the host
  periodically checks for a newer Deck Shelves on your chosen channel and, when it
  finds one, downloads it and reloads — so you stay up to date and the
  "update available" prompt goes away without you doing anything.
- **Brings its own copy of Deck Shelves.** If Deck Shelves is not already on the
  machine, the service fetches it — reusing a local copy, copying it from an
  installed plugin loader, or downloading the newest release — so it can run
  Deck Shelves on its own. Opt into pre-release versions with `SHELVES_PRERELEASE=1`.
- **Real data, hosted here.** The service now runs the Deck Shelves data
  backend itself — settings, backups and friends — supervising it, restarting
  it on crashes, and surfacing its logs in one place. Drop the backend at
  `backend/` next to the binary (or set `SHELVES_BACKEND_DIR`) and everything
  else is automatic.
- **Plays nice with another host.** If Deck Shelves is already mounted by a
  different host on the same machine, the service never loads it twice or takes
  over — it adds only its own Quick Access tab alongside. `SHELVES_FORCE_OWNER=shelveshub`
  makes ShelvesHub the host when it is the only one installed (and boots it
  immediately); it does not wrestle a host that already owns the renderer — one
  writer for your settings, always. On a shared machine, `SHELVES_OWNER_SETTLE_SECS`
  lets it wait for the other host to start before ever hosting on its own.
- **Restart to apply, in one click.** Change a setting that needs a restart and a
  **Restart to apply** button appears at the top of the hub page — it restarts the
  host and Steam together so your change takes effect, in your language.
- **Deck Shelves, right in the Steam menu.** This host's own Quick Access tab
  opens the Deck Shelves editor directly — validated on a Steam Deck. With
  another host also installed, both tabs work side by side and edit the same
  settings, and the plugin's wide side panel opens from whichever one is on
  screen. One place to edit, whichever tab you reach for.
- **A resilient fallback that remembers your choice.** If Deck Shelves can't be
  brought up, the host's own tab shows a compact ShelvesHub panel — icon'd actions
  to fetch the latest Deck Shelves and view logs, plus **Automatic updates** as a
  tidy set of switches: a master, then ShelvesHub and Deck Shelves each with their
  own pre-release channel, where each finer switch only appears once the one above
  it is on. Your choices are saved with a rolling backup, so they survive a crash
  or a restart without losing or corrupting your settings.
- **Logs you can actually read.** The Logs view shows one stream — the host
  runtime and the service together, newest first — with each line tagged by
  level (info / warning / error) and category and colour-coded, plus a refresh
  control. It **slides in over the tab**, its rows are **gamepad-navigable**, and
  **B takes you back** — so tracking down a problem no longer means scraping a
  console.
- **The native tab, on by default.** The Steam menu tab now shows real buttons and
  toggles out of the box; it proved safe as a sole host, and still falls back to
  the on-screen panel if anything goes wrong.
- **Shelves show up faster.** The service hosts the interface as soon as it settles
  rather than waiting for its next slow cycle, and on macOS and Windows — where it
  is always the only host — it hosts right away.
- **Full Deck Shelves on macOS and Windows.** As the only host, it now brings up
  everything, including online features (wishlist, prices, launchers) by fetching
  the data backend for you.
- **One-click install on Linux, too.** A double-click desktop installer for Linux
  joins the SteamOS one.

This release also includes the work that turned the loader from a skeleton
into something that actually runs Deck Shelves.

- **Deck Shelves now loads into Steam.** The loader detects the Steam interface,
  injects Deck Shelves, and recovers on its own if Steam restarts.
- **A debug tool that works everywhere.** `shelves-devtools` lets you inspect,
  inject and watch the Steam interface from the terminal on Linux, macOS and
  Windows — including remotely on a Steam Deck over SSH.
- **Try it without a Steam Deck.** A local test mode runs everything against a
  normal browser with an example Deck Shelves panel, so you can confirm it works
  before touching real hardware.
- **One step to run on the Deck.** Scripts to install and start the loader on a
  Steam Deck over SSH, plus a debugging guide.
- **One tool to drive it all.** `pnpm setup` installs everything you need on a
  Mac in one go, and simple `pnpm` commands build, run, debug and deploy to the
  Deck.
- **A Deck Shelves panel with its own icon.** Deck Shelves can open a dedicated
  panel with an icon, like other Steam Deck plugins. It works now as an
  on-screen panel; the fully native Steam-menu version is in progress.
- First version of ShelvesHub: the background service, installers for Linux,
  macOS and Windows, and logging. Groundwork only — it did not yet load Deck
  Shelves.
