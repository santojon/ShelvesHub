# Release Notes

Highlights for each release, written for people using ShelvesHub. The full,
detailed list of changes lives in [CHANGELOG.md](CHANGELOG.md).

Releases are created automatically by CI when a version tag (`vMAJOR.MINOR.PATCH`)
is pushed — the notes below are picked up and published with the release.

## [Unreleased]

- **Real data, hosted here.** The service now runs the Deck Shelves data
  backend itself — settings, backups and friends — supervising it, restarting
  it on crashes, and surfacing its logs in one place. Drop the backend at
  `backend/` next to the binary (or set `SHELVES_BACKEND_DIR`) and everything
  else is automatic.
- **Plays nice with another host.** If Deck Shelves is already mounted by a
  different host on the same machine, the service stands down instead of
  loading it twice. Prefer this host? `SHELVES_FORCE_OWNER=shelveshub` makes
  the hand-over explicit and safe — one writer for your settings, always.
- **Deck Shelves, right in the Steam menu.** This host's own Quick Access tab
  opens the Deck Shelves editor directly — validated on a Steam Deck. With
  another host also installed, both tabs work side by side and edit the same
  settings, and the plugin's wide side panel opens from whichever one is on
  screen. One place to edit, whichever tab you reach for.

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
