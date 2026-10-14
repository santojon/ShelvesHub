# HostApi — Contract Reference

*[Leia em português](pt-BR/host-api.md)*

Contract version: **1.5.0** (additive-only after the 1.0.0 baseline).

The `HostApi` interface defines what the ShelvesHub host process provides
to the Deck Shelves bundle. The bundle receives this object as
`window.__SHELVES_HOST__` at startup.

The typed contract lives in the `@deck-shelves/host` package, vendored as the
`host/` submodule: `host/src/contract/index.ts` is the reference surface
(`HostApi` plus the renderer globals; `index.api.md` is its generated API
report). The **executed** implementation the daemon injects is the host runtime
— `runtime/shelves-host.js` with its `-qam.js`, `-api.js`, `-sidecar.js` and
`-toast.js` parts, assembled into one script (`shelves-host-api.js` builds the
object) — that is what becomes `window.__SHELVES_HOST__` in the renderer. The
daemon derives `HOST_API_VERSION` from the contract at build time and stamps it
into the runtime, so the three never drift. The Deck Shelves repository builds
its bundle to consume this contract.

Shape history: 1.1.0 added `qam`; 1.2.0 `updates` and the `React` / `ReactDOM` /
`jsx` members; 1.3.0 `handshake()`, `lifecycle.teardown` and the route patches;
1.4.0 `device` and `bundleVersion` in the handshake; 1.5.0 the cooperative-bundle
hand-over globals.

---

## Namespaces

Optional members are feature-detected by the bundle (`host.qam?.…`); a host
implements the ones it can.

### `version`

The contract version the host implements (`"1.5.0"`).

### `lifecycle: HostLifecycle`

| Method | Signature | Notes |
|---|---|---|
| `register` | `(plugin: { name, version }) => Disposable` | Call once at bundle mount; the disposer unregisters |
| `onMount` | `(cb: () => void) => void` | Fires when the bundle mounts |
| `onUnmount` | `(cb: () => void) => void` | Fires on teardown |
| `teardown?` | `() => number` | Optional (1.3.0). Runs every `onUnmount` handler once and clears them before a hot-swap; returns the count |

### `rpc: HostRpc`

| Method | Signature | Notes |
|---|---|---|
| `call` | `<Req, Res>(method: string, args?: Req) => Promise<Res>` | JSON-RPC call into the Rust host process |

`call` POSTs to the daemon's local HTTP server (`127.0.0.1:60123` by default)
with the per-boot bearer token the daemon stamped into the runtime — see
[RPC wire format](#rpc-wire-format).

### `ui: HostUi`, `React`, `ReactDOM`, `jsx`

Steam's own UI primitives, found in Steam's webpack modules (never
reimplemented): `ConfirmModal`, `DialogBody`, `DialogButton`,
`DialogControlsSection`, `Dropdown`, `DropdownItem`, `Field`, `Focusable`,
`GamepadButton`, `Menu`, `MenuItem`, `Navigation`, `SliderField`, `Spinner`,
`Tabs`, `TextField`, `ToggleField`, plus `showContextMenu(menu)` and
`showModal(modal)`. Typed `unknown` so the contract stays dependency-free; the
bundle casts at the call site. `React`, `ReactDOM` and `jsx` (optional, 1.2.0)
are Steam's React stack, so a bundle running on a sole host resolves React from
the host instead of a loader global.

### `routes: HostRoutes`

| Method | Signature | Notes |
|---|---|---|
| `register` | `(path, component) => Disposable` | Register a full-page route; the disposer removes it |
| `addPatch?` | `(path, patch: RoutePatch) => RoutePatch` | Optional (1.3.0). Patch an existing route in place (e.g. wrap the Home to inject shelves); returns the same `patch` |
| `removePatch?` | `(path, patch) => RoutePatch` | Optional (1.3.0). Remove a patch added with `addPatch` |

A `RoutePatch` is `(props) => { children? } | void` — it receives a shallow copy of
the route's props and returns a partial override (today only `children` is honored).
The runtime also keeps the older `addRoute` / `removeRoute` pair for bundles that
still call it.

### `notifications?: HostNotifications`

Optional. Shows a toast in the Steam UI.

| Method | Signature |
|---|---|
| `toast` | `({ title?, body, durationMs? }) => void` |

On this host the toast goes through Steam's own notification pipeline when that
path installed, and always into the hub's Notifications list; `mode()` reports
which (see [troubleshooting](./troubleshooting.md#notifications)).

### `platform: PlatformApi`

| Method | Signature | Notes |
|---|---|---|
| `listCollections` | `() => Promise<PlatformCollection[]>` | The user's collections (`{ id, name }`) |
| `listLibraryTabs` | `() => Promise<PlatformTab[]>` | Library tabs (`{ id, name, source? }`) |
| `resolveShelfAppIds` | `(source, limit, sort?, shelfId?, sortReverse?, options?) => Promise<number[]>` | App ids for a shelf source; `options` carries `hiddenAppIds` and `dedupeByName` |
| `getAppName` | `(appid) => Promise<string>` | |
| `getAppMeta` | `(appid) => Promise<PlatformAppMeta>` | Artwork URLs, install state, compatibility, playtime, … |
| `getAppMetaBatch?` | `(appids) => Promise<Map<number, PlatformAppMeta>>` | Optional |
| `navigateToApp` | `(appid) => void` | Navigate the Steam UI to a game page |
| `navigateToShelfSource?` | `(source, title?) => void` | Optional |
| `getOSVersion?` | `() => string` | Optional |
| `checkCompatibility?` | `() => boolean` | Optional |

On this host the runtime implements only `getOSVersion`, `checkCompatibility`
and `navigateToApp`. The library members (`listCollections` …
`navigateToShelfSource`) are Deck Shelves domain logic: the bundle composes its
own implementation over the runtime's object (`resolveHost()` in the plugin), so
they are not callable on `window.__SHELVES_HOST__.platform` directly.

### `qam?: HostQam` *(added in 1.1.0)*

| Method | Signature | Notes |
|---|---|---|
| `registerPanel` | `(panel: QamPanel) => () => void` | Registers the panel (same `id` replaces it); returns an unregister function |

`QamPanel = { id: string; title: string; icon?: string /* inline SVG or data URI */; render?(container: HTMLElement): void \| (() => void); content?: unknown }`
— exactly one of `render` (framework-agnostic, into a host-owned container) or
`content` (a React node, or a zero-arg factory returning one, rendered in the
host's own React tree so the bundle's context providers reach it).

On this host the tab is first-class (`runtime/shelves-host-qam.js`): a native
Quick Access tab (key `900` in Steam's tab enum, inserted after Performance)
that Steam's strip treats like its own. It is present from boot, before any
panel is registered; the registered panel (the Deck Shelves editor) fills it
when `registerPanel` fires, and without one it shows the hub's own view
(status, updates, configuration, logs). Nothing is drawn outside the tab: with
`native_qam` off, or while the tab cannot be installed (the trip breaker, or no
tab-list builder yet), the hub draws nothing and `qam.mode()` reports it
(`native`, `native-arming`, `tripped`, or `panel` for "not installed").

#### Tab-ownership handshake — `window.__SHELVES_QAM_OWNER__`

When Deck Shelves runs under another loader that *also* draws its own Quick Access
tab, exactly one Deck Shelves tab should be shown, and it should be this host's.
The host stamps `window.__SHELVES_QAM_OWNER__` with its owner kind (e.g.
`"shelveshub"`) **at the moment its own tab is actually inserted into the strip**
— deliberately not when the `window.__SHELVES_QAM__` bridge is first created (that
happens at start-up, before any tab exists). A bundle that renders its own early
tab retracts it once this signal is set, so there is never a moment with two tabs;
and because it is stamped only on real insertion, a host that never inserts a tab
leaves the bundle's own tab in place as the fallback rather than both vanishing.
Unset means no host has claimed the tab.

### `mainMenu?: HostMainMenu`

Optional: `registerEntry(entry) => () => void` adds an entry to the Steam Main
Menu (`{ id, title, icon, route? | onSelect? }`), shown only while an entry is
registered. Not implemented by this host; the bundle feature-detects it.

### `updates?: HostUpdates` *(added in 1.2.0)*

| Method | Signature | Notes |
|---|---|---|
| `canSelfInstall` | `() => boolean` | True while the copy of the bundle that runs is this host's own: as sole host, or under a loader once the cooperative-bundle hand-over happened (the loader's copy stood down or this host's copy booted); false in plain coexistence and plain cooperation, where the loader's copy runs |
| `applyUpdate` | `({ version, assetUrl?, assetName? }) => Promise<void>` | Obtains the release through the `applyUpdate` RPC (URL-pinned to the Deck Shelves releases) and swaps the bundle in; rejects with `applyUpdate: busy: …` while the daemon's own update check runs (retry shortly) |

### `handshake?(): HostHandshake` *(added in 1.3.0)*

Identifies the host so a bundle can adapt without feature-detecting each member:
`hostKind` (`"shelveshub"`), `hostVersion` (the daemon version),
`hostApiVersion`, `capabilities` (`teardown`, `selfUpdate`, `nativeQam`,
`coexist`, `coopBundle`; `pointerInput` and `xr` are defined but not reported by
this host) and, since 1.4.0, `device` (`{ kind, arch, model? }` from the daemon's
own detection) and `bundleVersion` (the Deck Shelves release this host last
installed, else — with the cooperative bundle on — the version its bundle file
embeds; absent until either is known). `nativeQam` is true only while this
host's own Quick Access tab is in the menu strip (inserted, breaker not tripped)
and `selfUpdate` equals `updates.canSelfInstall()`; both are computed on every
call. `hostVersion`, `device`, `bundleVersion` and `coopBundle` are read from the
daemon's current `window.__SHELVES_CONFIG__` stamp on every call too, so a bundle
swapped in place reports its own version.

---

## Renderer globals

The contract also names the globals the host and the bundle use to agree on
ownership (typed readers in `host/src/contract/index.ts`):

| Global | Written by | Meaning |
|---|---|---|
| `__SHELVES_HOST__` | the host runtime | The `HostApi` object. Left unset in coexistence so host selection is not disturbed |
| `__SHELVES_QAM__`, `__SHELVES_QAM_PENDING__` | host, bundle | The `qam` surface on its own, present even in coexistence; panels registered before it existed are drained from the pending array |
| `__SHELVES_QAM_OWNER__` | the host | The tab-ownership handshake above |
| `__SHELVES_FORCE_OWNER__` | the daemon | Cooperative ownership: a bundle the loader launched binds to the injected host |
| `__DECK_SHELVES_OWNER__`, `__DECK_SHELVES_OWNER_META__` | the owning bundle | The renderer's single-owner claim and the owner's version identity |
| `__DECK_SHELVES_DEFER_TO_HOST__`, `__DECK_SHELVES_HOST_BUNDLE_BOOTED__`, storage key `shelveshub-coop-bundle` | the two bundle copies, the host | The cooperative-bundle hand-over (1.5.0): the host's standing offer and the loader copy's stand-down signal |

---

## Adding a new method

1. Add the signature to the relevant interface in `host/src/contract/index.ts`
   and bump `HOST_API_VERSION` (minor for an additive member).
2. Implement it in the host runtime (`runtime/shelves-host-api.js` builds the
   object).
3. If the method calls into the Rust host, add the handler in `src/rpc.rs`'s
   `dispatch()` function.
4. Update this document.

The contract is **additive-only** — removing or changing existing signatures
requires a major version bump in `HOST_API_VERSION`.

---

## RPC wire format

The host RPC server (`127.0.0.1:60123` by default; `rpc_host` / `rpc_port` in
the config file) is an HTTP/1.1 endpoint. Every request is a `POST` whose body
is `{ "method": ..., "args": ... }`, and it must carry two headers:

- `Content-Type: application/json` — anything else answers **415** before the
  body is parsed (a cross-origin page cannot set it without a preflight);
- `Authorization: Bearer <token>` — the per-boot token the daemon stamps into
  the runtime (`window.__SHELVES_CONFIG__.rpcToken`) over its private CDP
  channel and writes, mode 0600, to `~/.local/share/shelveshub/.rpc-token`
  (Linux/macOS) or `%LOCALAPPDATA%\shelveshub\.rpc-token` (Windows;
  `SHELVES_RPC_TOKEN_FILE` overrides) for same-user tools such as the tray. A
  missing or wrong token answers **401**, before any dispatch. The token changes
  on every daemon start.

The response is JSON; application errors are HTTP 200 with `ok: false`:

```
→ POST / {"method":"ping"}
← {"ok":true,"result":"pong"}

→ POST / {"method":"getVersion"}
← {"ok":true,"result":"0.5.0"}

→ POST / {"method":"unknown"}
← {"ok":false,"error":"unknown method: unknown"}
```

From a shell on the same machine:

```sh
TOKEN="$(cat ~/.local/share/shelveshub/.rpc-token)"
curl -s http://127.0.0.1:60123/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"method":"ping"}'
```

**Methods** (`dispatch()` in `src/rpc.rs`):

| Group | Methods |
|---|---|
| Health and handshake | `ping`, `getVersion`, `getHostApiVersion`, `isInjected`, `getDiagnostics` |
| Hosted backend | `getBackendStatus`, `restartBackend`, and the plugin backend's public API names (the `BACKEND_METHODS` allowlist, 35 names), proxied only while backend hosting is configured |
| Plugin bundle | `populateBundle`, `applyUpdate` (URL-pinned to the Deck Shelves releases), `rollbackBundle` |
| Hub binary | `checkUpdates`, `selfUpdate`, `rollbackHub`, `restartService` |
| Hub settings store | `getConfig`, `setAutoUpdate`, `setUpdatePref`, `setConfigSync` |
| Operational config | `getRuntimeConfig`, `setRuntimeConfig` (a fixed set of editable keys; `recover_cmd` is never settable over RPC), `setBootMovie`, `setHostingPaused` |
| Logs | `getLogs`, `clearLogs`, `pushLogs` |

Anything else answers `unknown method`.

Answers worth knowing: `populateBundle`, `applyUpdate`, `rollbackBundle`,
`rollbackHub` and `selfUpdate` answer `busy: an update check is in flight, try
again shortly` while the daemon's own check runs (retry a moment later);
`selfUpdate` answers `{"updated":false,"reason":"current"}` when nothing newer
is published and `"staged"` while that same release already waits for a
restart; `rollbackHub` is refused while a ShelvesHub update or rollback is
already staged (restart first). After `populateBundle` or `applyUpdate` swaps a
release in, or `rollbackBundle` puts the previous one back, the hub also brings
the Python backend in its install folder to that same release and restarts it (a
backend directory configured elsewhere with `SHELVES_BACKEND_DIR` is never
touched). At the HTTP layer a request line or header
longer than 8 KiB, or more than 64 headers, answers **400**, and the server
holds at most 64 connections at once — beyond that it answers **503**. The
daemon log records only the method name of a request, never its body, and the
health, status and log polls are not logged at all.

`HostRpc.call` wraps all this in a `fetch` POST so the bundle manages neither
sockets nor the token.
