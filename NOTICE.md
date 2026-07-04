# Notice — Acknowledgements & Inspirations

Shelves Loader (MIT) is the standalone host **daemon** for Deck Shelves — the
process that injects Deck Shelves into Steam. It was written independently
(clean-room): no source is copied from the project below, and none of its
packages are redistributed.

This file is explicit about **which techniques** the loader re-implements. The
loader's scope is the injector daemon only. The injected **host runtime** — the
Steam UI layer and its patch helpers — lives in a separate package,
[`@deck-shelves/host`](https://github.com/santojon/Deck-Shelves/tree/main/host);
its UI-side acknowledgements are in that package's `NOTICE.md`, not here.

If you maintain the project below and would like the wording, link, or
attribution adjusted, please open an issue — this is honest credit, not a claim
of endorsement or affiliation.

## Inspirations

- **[plugin loader](https://github.com/SteamDeckHomebrew/a plugin loader)** (GPL-2.0)
  — reference for the injector-daemon concept: enabling Steam's CEF remote
  debugging, discovering the Steam renderer target, injecting a script/bundle
  into the renderer over the DevTools protocol, and tracking the renderer
  lifecycle to re-inject across Steam restarts. Re-implemented from scratch in
  Rust against the public Chrome DevTools Protocol; no plugin loader code
  (GPL-2.0) was copied or adapted — this is deliberately avoided to keep the
  loader under the MIT license.

## Steam / SteamOS

Shelves Loader drives Steam's CEF renderer via the DevTools protocol. Steam,
SteamOS, and Steam Deck are trademarks of Valve Corporation. This is an
unofficial, community project, not affiliated with or endorsed by Valve, and it
redistributes none of Steam's components.
