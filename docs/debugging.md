# Debugging & DevTools

Shelves Loader injects the Deck Shelves bundle into Steam's CEF (Chromium
Embedded Framework) renderer over the **Chrome DevTools Protocol (CDP)**. Because
CEF and Chromium speak the same protocol, the same tooling works against a real
Steam Deck and against a plain local browser — from Linux, macOS or Windows.

There are two things in this repo for that:

- **`shelves-devtools`** — a small cross-platform CDP client (the project's own
  dev tools). Built alongside the loader (`cargo build`).
- **The local debug harness** — an example bundle + an HTML page that stubs the
  Steam environment, so you can verify the full injection + RPC path with no
  hardware.

---

## How injection works (Set 2)

1. **Discovery.** The loader fetches `http://<cef-host>:<cef-port>/json` and
   picks the renderer target (Steam's `SharedJSContext` / Big Picture window, or
   a target matched by `SHELVES_TARGET`).
2. **Probe.** It opens a WebSocket to the target's `webSocketDebuggerUrl` and
   evaluates `window.__SHELVES_LOADER__?.injected` to see if the bundle is
   already running (idempotent, safe to repeat).
3. **Inject.** If not, it evaluates the host runtime (`runtime/shelves-host.js`
   → `window.__SHELVES_HOST__`, including QAM panel support), then reads and
   evaluates `bundle/index.js`, then stamps `window.__SHELVES_LOADER__`.
4. **Lifecycle.** The connection is re-established every tick, so a Steam restart
   (fresh, marker-less renderer) is re-injected automatically. `isInjected` over
   RPC reflects the last observed state.

Configuration (all optional, env-driven — see `src/config.rs`):

| Var | Default | Meaning |
|---|---|---|
| `SHELVES_CEF_HOST` | `127.0.0.1` | DevTools host |
| `SHELVES_CEF_PORT` | `8080` | DevTools port (Steam CEF default) |
| `SHELVES_RPC_ADDR` | `127.0.0.1:60123` | Host RPC bind address |
| `SHELVES_BUNDLE_PATH` | `<exe-dir>/bundle/index.js` | Bundle to inject |
| `SHELVES_HOST_RUNTIME_PATH` | `<exe-dir>/runtime/shelves-host.js` | Host runtime (`window.__SHELVES_HOST__`, incl. QAM) |
| `SHELVES_TARGET` | _auto_ | Title/URL substring to pick the target |
| `SHELVES_INTERVAL_SECS` | `30` | Injection-loop interval |

---

## `shelves-devtools`

```bash
cargo build
TOOL=target/debug/shelves-devtools

$TOOL targets                              # list DevTools targets
$TOOL probe                                # is the bundle injected?
$TOOL eval "navigator.userAgent"           # evaluate JS in the renderer
$TOOL inject --bundle bundle/index.js      # inject a bundle (--force to re-inject)
$TOOL reload --ignore-cache                # reload the renderer (after an update)
$TOOL console                              # stream console + exceptions (Ctrl-C)
```

Global flags / env: `--host` (`SHELVES_CEF_HOST`), `--port` (`SHELVES_CEF_PORT`),
`--target` (`SHELVES_TARGET`).

---

## Local debug (no Steam Deck)

The fastest way to verify a change. Launches a Chromium-family browser with
remote debugging, runs the loader against it, injects the example bundle, and
prints the verification output.

```bash
scripts/local-debug.sh             # Linux/macOS (headless)
HEADLESS=0 scripts/local-debug.sh  # show the rendered shelves in a window
```

```powershell
pwsh scripts/local-debug.ps1       # Windows
```

It auto-detects Chrome/Chromium/Edge/Brave (override with `BROWSER=/path`). The
harness (`examples/harness/`) stubs `window.SteamClient` and a local
`window.__SHELVES_HOST__`, and the example bundle (`examples/bundle/`) exercises
the lifecycle, the RPC channel, route/notification calls, and renders sample
shelves.

To drive it by hand against the harness on port 9222:

```bash
# launch a browser yourself, then:
shelves-devtools --port 9222 --target harness targets
shelves-devtools --port 9222 --target harness inject --bundle examples/bundle/shelves-example.js
shelves-devtools --port 9222 --target harness eval "window.__SHELVES_DEMO__"
```

---

## QAM panel (Quick Access Menu)

The host runtime exposes `host.qam.registerPanel({ id, title, icon, render })`,
so the bundle can add a dedicated panel with its own icon. The example bundle
registers one (a shelf icon) that renders the sample shelves.

The implementation (`runtime/shelves-host.js`) currently renders an icon rail +
slide-in panel that works identically in the local harness and as an overlay in
Steam. The seam for a **native** Steam QAM tab (`tryMountNative`, backed by the
webpack module-finder) is in place but stubbed until it can be validated on a
real device. After `pnpm debug:local`, look for the shelf icon (top-right) or
check it programmatically:

```bash
shelves-devtools --port 9222 --target harness \
  eval "!!window.__SHELVES_HOST__.qam._panels['deck-shelves']"
```

---

## Debugging on a real Steam Deck (over SSH)

1. **Enable Steam CEF remote debugging.** `scripts/deck-deploy.sh` does this for
   you (it `touch`es `~/.steam/steam/.cef-enable-remote-debugging`). After the
   first time, **fully restart Steam** so the `:8080` endpoint comes up.

2. **Deploy & run the loader on the Deck:**

   ```bash
   cp .env.example .env   # fill in DECK_HOST / DECK_USER / DECK_SSH_KEY
   scripts/deck-deploy.sh
   ```

3. **Debug from your machine.** Forward the Deck's DevTools port, then use the
   same `shelves-devtools` you use locally:

   ```bash
   scripts/deck-tunnel.sh          # localhost:8080 -> deck:8080
   # in another terminal:
   shelves-devtools --port 8080 targets
   shelves-devtools --port 8080 console
   shelves-devtools --port 8080 inject --bundle bundle/index.js   # push an update
   shelves-devtools --port 8080 reload                            # apply it
   ```

Logs on the Deck:

```bash
ssh deck@deck.local 'journalctl --user -u shelves-loader -f'
```

---

## Third-party dependencies & licensing

All runtime crates are dual-licensed **MIT OR Apache-2.0**, compatible with this
project's MIT license:

| Crate | Use | License |
|---|---|---|
| `tungstenite` | Blocking WebSocket (CDP transport) | MIT OR Apache-2.0 |
| `serde` / `serde_json` | JSON (CDP messages, RPC) | MIT OR Apache-2.0 |
| `clap` | `shelves-devtools` CLI | MIT OR Apache-2.0 |
| `chrono` | Log timestamps | MIT OR Apache-2.0 |

The CDP client is written from scratch against the public protocol spec; no
third-party CDP or Steam-loader source is copied or adapted.
