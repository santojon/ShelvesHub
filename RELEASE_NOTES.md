# Release Notes

Highlights for each release, written for people using ShelvesHub. The full,
detailed list of changes lives in [CHANGELOG.md](CHANGELOG.md).

Releases are created automatically by CI when a version tag (`vMAJOR.MINOR.PATCH`)
is pushed — the notes below are picked up and published with the release.

## [Unreleased]

- **A native tab that looks the part.** The host's Quick Access tab now renders
  real Steam buttons and toggles — with a gamepad focus ring and a ShelvesHub icon
  that tints to your theme — so it feels like the rest of the interface.
- **Click to install.** Double-click installers for macOS and Windows, each with
  the ShelvesHub icon, alongside the one-click scripts for SteamOS, Linux, macOS
  and Windows.
- **Updates itself.** When a new Deck Shelves is available, the host can fetch and
  install it for you — no manual file copying.
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
  over — it adds only its own Quick Access tab alongside. Prefer this host?
  `SHELVES_FORCE_OWNER=shelveshub` makes the hand-over explicit and safe — one
  writer for your settings, always. On a shared machine, `SHELVES_OWNER_SETTLE_SECS`
  lets it wait for the other host to start before ever hosting on its own.
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
