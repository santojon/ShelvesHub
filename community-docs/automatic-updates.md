# Automatic updates

*[Leia em português](pt-BR/automatic-updates.md)*

ShelvesHub keeps both itself and Deck Shelves current, so you rarely have to
think about versions. Everything here is controlled from the ShelvesHub tab in
the Quick Access Menu (see [quick-access-panel.md](quick-access-panel.md)).

## How the switches nest

There's a master auto-update switch, and under it two separate switches — one
for **ShelvesHub** and one for **Deck Shelves**. Each of those has its own
**pre-release channel** toggle. A lower switch only appears once the switch
above it is on, so the panel stays uncluttered: turn on auto-update to reveal
the two targets, turn on a target to reveal its pre-release channel.

## Deck Shelves updates

With auto-update on, ShelvesHub checks periodically for a newer Deck Shelves
release on your chosen channel and installs it in place, then reloads — so the
"update available" prompt clears on its own. Updating the bundle is a hot-swap:
it doesn't reload the whole interface, it just re-injects the new bundle on the
next cycle.

Note: ShelvesHub only auto-updates Deck Shelves when **it** is the host. If a
plugin loader owns the bundle instead, ShelvesHub leaves updates to that host
(see [coexistence.md](coexistence.md)).

## ShelvesHub updating itself

The **Update ShelvesHub** action downloads the release for your OS, verifies
the binary, and swaps it over the running one. Where the service manager
relaunches the daemon for you (macOS/Linux service, Windows scheduled task) it
then restarts to finish; otherwise it shows a "downloaded — restart to finish"
notice.

## Pre-release channels

Each pre-release toggle opts that target into beta builds. Leave them off for
stable releases only; turn one on if you want to test upcoming changes early.
They're independent — you can run a stable host with pre-release Deck Shelves,
or the other way around.

## Troubleshooting

- **Updates aren't showing up.** Confirm auto-update is on, and check the
  right channel — a stable install won't see pre-release builds. The check is
  throttled, so it isn't instant.
- **A pre-release has a bug.** Turn its pre-release toggle off; the next check
  brings you back to the latest stable release (it never downgrades across a
  higher stable version).
