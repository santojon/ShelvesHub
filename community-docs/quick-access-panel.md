# The ShelvesHub Quick Access panel

*[Leia em português](pt-BR/quick-access-panel.md)*

ShelvesHub adds its own tab to the Steam Quick Access Menu — separate from the
Deck Shelves editor tab. This is the part that makes it more than an injector:
it's where you manage updates, read logs, tweak safe settings, and recover
when something's off. It's gamepad-navigable, matches the native Steam look,
and has a pinned version footer.

## What's in it

**Automatic updates** — turn auto-update on, with separate switches for
ShelvesHub and for Deck Shelves, and an optional pre-release channel for each.
There are also buttons to update now. See
[automatic-updates.md](automatic-updates.md).

**Troubleshooting** — view the merged log (host + runtime in one stream), or
**disable the host until the next restart** without uninstalling anything.

**Configuration + Status** — a curated, safe subset of the settings is
editable right here (things like the native tab, the boot animation, update
preferences, coexistence timing). Ports, hostnames and paths are shown
read-only. Anything that needs a restart to take effect surfaces a **Restart
to apply** button that restarts the host and Steam together.

**Log viewer** — the host and the injected runtime logs in one colour-coded,
newest-first, gamepad-navigable stream, with clear/refresh controls. B takes
you back.

## Restart to apply

Some settings (coexistence timing, the boot animation, the native tab) are
only read when the host or Steam starts. When you change one, the panel shows
a **Restart to apply** button so you don't have to restart anything by hand —
one press restarts the host and bounces Steam for you.

## If the bundle can't load

If Deck Shelves itself fails to load for some reason, the tab shows a
ShelvesHub recovery panel with actions instead of an empty tab — your Home
shelves still load regardless.

## Troubleshooting

- **The tab isn't there.** The native tab is on by default; if it was turned
  off, re-enable it in Configuration (or see
  [troubleshooting.md](troubleshooting.md) for the `native_qam` setting).
- **A setting I changed didn't take effect.** Look for the **Restart to
  apply** button — some settings only apply after a restart.
