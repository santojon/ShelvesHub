# Debugging & DevTools

*[Leia em português](pt-BR/debugging.md)*

ShelvesHub injects the Deck Shelves bundle into Steam's CEF (Chromium
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

## How injection works

1. **Discovery.** The loader fetches `http://<cef-host>:<cef-port>/json` and
   picks the renderer target (Steam's `SharedJSContext` / Big Picture window, or
   a target matched by `SHELVES_TARGET`).
2. **Probe.** It opens a WebSocket to the target's `webSocketDebuggerUrl` and
   evaluates `window.__SHELVES_LOADER__?.injected` to see if the bundle is
   already running (idempotent, safe to repeat).
3. **Inject.** If not, it stamps `window.__SHELVES_CONFIG__` (the RPC endpoint
   and per-boot token, the contract version, the device), inlines the i18n
   dictionaries, evaluates the host runtime — `runtime/shelves-host.js` and its
   `-qam.js` / `-api.js` / `-sidecar.js` / `-toast.js` parts, assembled into one
   script that becomes `window.__SHELVES_HOST__` — then reads and evaluates
   `bundle/index.js`, then stamps `window.__SHELVES_LOADER__`.
4. **Lifecycle.** The connection is re-established every tick, so a Steam restart
   (fresh, marker-less renderer) is re-injected automatically. `isInjected` over
   RPC reflects the last observed state. Each tick starts with a health gate on
   the target list: the visible Steam UI lives in windows that are separate
   targets from `SharedJSContext`, so a lone `SharedJSContext` means the UI
   collapsed — the loop then pauses injection and runs the per-platform recovery
   once (see [troubleshooting](./troubleshooting.md)) instead of injecting.

Configuration (all optional, env-driven — see `src/config.rs`):

| Var | Default | Meaning |
|---|---|---|
| `SHELVES_CEF_HOST` | `127.0.0.1` | DevTools host |
| `SHELVES_CEF_PORT` | `8080` | DevTools port (Steam CEF default) |
| `SHELVES_RPC_HOST` | `127.0.0.1` | Host RPC bind host (keep it on loopback) |
| `SHELVES_RPC_PORT` | `60123` | Host RPC bind port |
| `SHELVES_RPC_ADDR` | `127.0.0.1:60123` | `host:port`, used when `SHELVES_RPC_HOST` / `SHELVES_RPC_PORT` are unset (those two win when set); then `rpc_host` / `rpc_port` from the config file. The tray resolves the address the same way |
| `SHELVES_RPC_TOKEN_FILE` | `~/.local/share/shelveshub/.rpc-token` | Where the per-boot RPC token is written (mode 0600) for same-user tools; `%LOCALAPPDATA%\shelveshub\.rpc-token` on Windows |
| `SHELVES_BUNDLE_PATH` | `<exe-dir>/bundle/index.js` | Bundle to inject |
| `SHELVES_HOST_RUNTIME_PATH` | `<exe-dir>/runtime/shelves-host.js` | Host runtime (`window.__SHELVES_HOST__`, incl. QAM) |
| `SHELVES_TARGET` | _auto_ | Title/URL substring to pick the target |
| `SHELVES_INTERVAL_SECS` | `30` | Injection-loop interval |
| `SHELVES_NATIVE_QAM` | `0` (the shipped config file sets `native_qam: true`) | Add a native Quick Access tab (`1` to enable) |
| `SHELVES_OWNER_SETTLE_SECS` | `0` | Seconds to wait for another host to claim an unclaimed renderer before hosting it (coexistence; `0` = host immediately) |
| `SHELVES_HUB_CONFIG` | `<settings_dir>/shelveshub.json` | The host's own settings store (auto-update preference; atomic writes + backup) |

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
$TOOL preload --script my-script.js        # register a document-start script on matching pages and hold the session (--duration N, or Ctrl-C)
```

Global flags / env: `--host` (`SHELVES_CEF_HOST`), `--port` (`SHELVES_CEF_PORT`),
`--target` (`SHELVES_TARGET`), `--timeout N` (give up after N seconds with exit code 124; 0,
the default, waits forever). `inject` evaluates the file as-is and stamps the
loader marker — it adds no config stamp (so no RPC token) and no host runtime, so
it is for pushing a bundle into a renderer the daemon already prepared. `preload`
uses browser-level auto-attach: the script is registered on each matching page
as it attaches, and applies to that page's next document; targets are never
paused.

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

The loader runs sealed off in a temporary folder — a copy of the bundle, its own settings, hub
store (updates and settings sync off), token file and an empty backend folder, with the boot
movie and auto-recovery off — on RPC port `60124` (`SHELVES_RPC_PORT` overrides), so it downloads
nothing and touches neither an installed service's port and files nor this machine's Steam.

To drive it by hand against the harness on port 9222:

```bash
# launch a browser yourself, then:
shelves-devtools --port 9222 --target harness targets
shelves-devtools --port 9222 --target harness inject --bundle examples/bundle/shelves-example.js
shelves-devtools --port 9222 --target harness eval "window.__SHELVES_DEMO__"
```

### Scenario harness

`pnpm harness` runs `runtime/shelves-host.js` against a mock of Steam's UI in a
headless browser, once per scenario, and asserts the outcome — the native tab,
coexistence mirroring, the sole-host path and the fallback panel are all covered
without a device. It is hermetic (the host RPC endpoint is stubbed in the mock),
so it needs no running daemon. Its service-side counterpart, `pnpm run harness:daemon`,
runs the real daemon against a headless Chromium whose pages stand in for Steam's
windows and checks the collapse → recovery path (see
[QA lab](qa-lab.md#daemon-scenarios)).

```bash
pnpm harness            # headless
HEADLESS=0 pnpm harness  # show the browser window
```

### Simulation harness in Docker (Linux)

`pnpm harness:docker` builds a small Linux image and runs five checks against a
headless Chromium in a container: the scenario harness above, the
**SteamOS/Linux install + uninstall lifecycle** (a recording `systemctl` stub
stands in — it validates the scripts' file lay-down/tear-down and settings
preservation, not systemd itself — and a stubbed `curl` serving a fake release,
so the generic Linux installer's download + SHA256SUMS branch, an upgrade over a
running daemon and `--purge` are covered offline), a **daemon → headless-Chromium injection
smoke** (the real daemon, offline on a copy of the example bundle, discovers the target over CDP
and injects), the
**daemon scenarios** above, and the **plugin backend probes** (the Deck Shelves backend's OS-coupled probes running
under the host). Cross-platform validation without a device; wired into CI.
arm64 via `PLATFORM=linux/arm64 pnpm harness:docker`.

> Windows install/uninstall cannot be containerized — Docker on Linux/macOS runs
> Linux containers only, and the Windows installer (NSIS + a PowerShell scheduled
> task) needs a real Windows host.

---

## The Quick Access tab

The host runtime exposes `host.qam.registerPanel({ id, title, icon, render | content })`,
so the bundle can fill the host's panel with its own content. The example bundle
registers one (a shelf icon) that renders the sample settings.

The implementation (`runtime/shelves-host-qam.js`) adds a **native** Steam Quick
Access tab: a numeric key (`900`) in Steam's tab enum, inserted after the
Performance tab, so the strip treats it like its own. The tab is present from
boot; the registered panel fills it, and without one it shows the hub's own view
(status, updates, configuration, logs, with the side panel for logs and
notifications). Nothing is drawn outside that tab — with `native_qam` off or the
trip breaker tripped there is no panel at all. Check it programmatically:

```bash
shelves-devtools --port 9222 --target harness \
  eval "window.__SHELVES_HOST__.qam.mode() + ' ' + Object.keys(window.__SHELVES_HOST__.qam._specs)"
```

`mode()` answers `native` (tab confirmed), `native-arming`, `tripped`, or
`panel` when the tab is not installed. The scenario harness
(`pnpm harness`) is the place to see the tab render against the Steam mock.

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
ssh deck@deck.local 'journalctl --user -u shelveshub -f'
```

On macOS the service log is `~/.local/share/shelveshub/logs/out.log` (errors in `error.log`
next to it); on Windows `%LOCALAPPDATA%\ShelvesHub\logs\out.log`, moved to `out.log.1` once it
passes 1 MiB.

### Log structure and the in-app viewer

Logs are **leveled** (`INFO` / `WARN` / `ERROR`) and **scoped** by category
(service side: `loader`, `backend`, `rpc`, …; runtime side: `HOST`, `UI`,
`ROUTER`, `QAM`, `MENU`, `NAV`, `RPC`, `UPDATE`). Each line is
`[LEVEL] [timestamp] [scope] message`, and the service keeps a bounded ring of
the most recent lines that the `getLogs` request returns.

The host runtime forwards its own entries to that ring over the `pushLogs`
request — warnings and errors always, and everything when verbose logging is on
(`window.__SHELVES_LOG_VERBOSE__ = true` in the renderer) — so `getLogs` returns
**one merged stream** of runtime and service lines. The runtime also keeps its
last entries in `window.__SHELVES_LOG__` (objects `{t, level, scope, msg}`) for
direct inspection over the DevTools connection.

Three more renderer globals help when the native tab misbehaves:
`window.__SHELVES_NATIVE_ERR__` holds the last error the tab's error boundary
caught (`message`, `stack`, `componentStack`); `window.__SHELVES_REFRESH__()`
re-renders the tab's panels in place; and `window.__SHELVES_FIBER_REPOINT__ = false`,
set before the runtime loads, opts out of the in-place re-point of an already
mounted menu (the tab then needs a menu close/open to appear).

The **Logs** action in the host's own tab renders that merged stream as a badged,
scrollable list (newest first) with a refresh control.

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
