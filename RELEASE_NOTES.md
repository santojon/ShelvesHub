# Release Notes

Highlights for each release, written for people using Shelves Loader. The full,
detailed list of changes lives in [CHANGELOG.md](CHANGELOG.md).

Releases are created automatically by CI when a version tag (`vMAJOR.MINOR.PATCH`)
is pushed — the notes below are picked up and published with the release.

## [Unreleased]

This is the first set of work that turns the loader from a skeleton into
something that actually runs Deck Shelves.

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

## [0.1.0] - 2026-05-13

- First version of Shelves Loader: the background service, installers for Linux,
  macOS and Windows, and logging. Groundwork only — it did not yet load Deck
  Shelves.
