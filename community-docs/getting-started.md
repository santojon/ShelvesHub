# Getting started with ShelvesHub

*[Leia em português](pt-BR/getting-started.md)*

ShelvesHub runs Deck Shelves on Steam **without a plugin loader**. It's a
small background service that watches for the Steam client, injects the Deck
Shelves bundle directly into the Big Picture / Game Mode interface, and gives
it everything it needs to run. You get your custom Home shelves and the full
Deck Shelves editor with nothing else to install first.

It runs on **Steam Deck / SteamOS, Linux, macOS, and Windows**.

## What you get

- **One-click install**, no separate plugin-loader setup step.
- **A Quick Access Menu tab** with the full Deck Shelves editor.
- **Automatic updates** — for ShelvesHub itself and for Deck Shelves, each
  with its own optional pre-release channel.
- **The data backend included**, so wishlist, prices, backups and device
  features work on a standalone install — not just local shelves.

## Installing

Grab the installer for your platform from the
[latest release](https://github.com/santojon/ShelvesHub/releases/latest) and
run it. The exact steps for each OS are in [installing.md](installing.md).
Once it's installed, **restart Steam** — ShelvesHub needs to catch Steam on
launch to inject — and Deck Shelves appears on your Home automatically.

## Where to configure things

Two places, both reached from the Steam Quick Access Menu:

- **The Deck Shelves tab** — the full shelf/settings editor, exactly as it
  works under a plugin loader.
- **The ShelvesHub tab** — the hub's own management panel: updates,
  troubleshooting, configuration and logs. See
  [quick-access-panel.md](quick-access-panel.md).

## Already have a plugin loader?

ShelvesHub coexists with one cleanly — install both and they share the same
settings, with exactly one Deck Shelves tab showing so nothing looks doubled.
See [coexistence.md](coexistence.md).

## Where to go next

- [installing.md](installing.md) — per-platform steps and uninstalling.
- [automatic-updates.md](automatic-updates.md) — update channels and how the
  hub updates itself.
- [troubleshooting.md](troubleshooting.md) — if nothing shows up or you hit a
  black screen.
