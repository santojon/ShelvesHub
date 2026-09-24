# The data backend (wishlist, prices, device features)

*[Leia em português](pt-BR/data-backend.md)*

Deck Shelves has features that need more than your local library — your
wishlist, on-sale rows, pricing, settings backups, and device state. Those are
served by a small data backend. On a standalone ShelvesHub install there's no
plugin loader to run it, so **ShelvesHub hosts the backend itself** — which is
why those features work with nothing else installed.

## What it does for you

Because the backend is included and supervised, a standalone install gets the
**full** Deck Shelves experience, not just local shelves:

- wishlist and on-sale shelves, with pricing and discount info;
- store-metadata filters;
- settings backups and cloud sync;
- device state (external display, and the rest).

## How it gets there

ShelvesHub obtains its own copy of the backend the same way it obtains the
Deck Shelves bundle: it reuses a local copy if there is one, copies one from an
installed plugin loader, or downloads it from the release. Then it runs and
supervises it — restarting it if it crashes and surfacing its logs in the
merged log viewer.

## Troubleshooting

- **Wishlist / prices are empty or a feature says it's unavailable.** Check the
  merged log in the ShelvesHub tab for backend errors, and confirm you're
  online. The backend is restarted automatically if it crashes, so a transient
  failure usually clears on its own.
- **It worked under a plugin loader but not standalone.** Both use the same
  backend, so this shouldn't differ — file a bug report with the log excerpt.
- More: [troubleshooting.md](troubleshooting.md).
