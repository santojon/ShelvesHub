# Running alongside a plugin loader

*[Leia em português](pt-BR/coexistence.md)*

You don't have to choose. If you already have a plugin loader installed,
ShelvesHub coexists with it cleanly on the same machine — it never loads Deck
Shelves twice, and it adds only its own management tab.

## What "coexistence" means in practice

- **Exactly one Deck Shelves tab shows.** When another host is already loading
  Deck Shelves, ShelvesHub doesn't add a second copy — it mirrors the same
  editor and stamps a tab-ownership handshake so you never see two.
- **Shared settings, one writer.** Both hosts read and write the same settings,
  and only one writes at a time, so your shelves stay consistent whichever tab
  you edit from.
- **The other host keeps its plugins.** ShelvesHub adds its own tab beside the
  other host without taking over its plugin list.

## "I installed ShelvesHub but my Home looks exactly the same"

That's expected when a plugin loader is **already** running Deck Shelves. The
loader stays the host, so your Home keeps behaving as before — ShelvesHub does
**not** replace or update that copy; it only adds its own tab. So:

- Your existing shelves and any quirks of the Deck Shelves version the loader
  installed are unchanged.
- Installing ShelvesHub does **not** upgrade the Deck Shelves the loader runs —
  update that through the loader as usual.
- **Very old Deck Shelves versions** predate the ShelvesHub integration, so they
  can't share their editor into the ShelvesHub tab. Update Deck Shelves in the
  loader to a current version for the best experience.

To check who's hosting and switch, open the **ShelvesHub tab** in the Quick
Access Menu. To make ShelvesHub host Deck Shelves instead of the loader, see the
next section — the loader stays installed for its other plugins.

## When ShelvesHub should be the host

If ShelvesHub is the only thing installed, it hosts Deck Shelves itself
automatically — no configuration needed. If you have both installed but want
ShelvesHub to own the Home, there's a **force-owner** setting; see below.

## Two settings you might touch

Both live in `shelveshub.config.json` (or the editable Configuration section of
the ShelvesHub tab). Changes take effect after a restart — use **Restart to
apply**.

**It grabbed a plugin the other host was about to load.** Give the other host
more time to claim the interface first:

```json
{ "owner_settle_secs": 25 }
```

**You want ShelvesHub to own the Home** when both are installed:

```json
{ "force_owner": true }
```

Force-owner makes ShelvesHub claim the interface immediately instead of waiting
its turn. It will **not** rip the Home away from another host that already owns
it — that isn't supported and could destabilise the interface — so if a live
host is already there, ShelvesHub simply stands down and coexists (its own tab
is still added).

## Troubleshooting

- **I see two Deck Shelves tabs, or settings look out of sync.** This isn't
  supposed to happen — file a bug report with both hosts' versions. By design
  only one tab shows and both read/write the same settings.
- **ShelvesHub took over a plugin I wanted the other host to run.** Increase
  `owner_settle_secs` and restart.
- More: [troubleshooting.md](troubleshooting.md).
