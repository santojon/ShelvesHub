# HostApi — Contract Reference

*[Leia em português](pt-BR/host-api.md)*

Contract version: **1.2.0** (additive-only after the 1.0.0 baseline).

The `HostApi` interface defines what the ShelvesHub host process provides
to the Deck Shelves bundle. The bundle receives this object as
`window.__SHELVES_HOST__` at startup.

The typed contract lives in the `@deck-shelves/host` package, vendored as the
`host/` submodule (`host/src/contract/`, with `ShelvesHostApi` in `shelves.ts` as
the reference surface). The **executed** implementation the
loader injects is `runtime/shelves-host.js` — that is what becomes
`window.__SHELVES_HOST__` in the renderer. The Deck Shelves repository builds
its bundle to consume this contract.

---

## Namespaces

### `lifecycle: LifecycleApi`

| Method | Signature | Notes |
|---|---|---|
| `register` | `() => void` | Call once at bundle mount |
| `onMount` | `(handler: () => void) => void` | Fires when the bundle mounts |
| `onUnmount` | `(handler: () => void) => void` | Fires on teardown |

### `rpc: RpcApi`

| Method | Signature | Notes |
|---|---|---|
| `call` | `<T>(method, args?) => Promise<T>` | JSON-RPC call into the Rust host process |

`call` POSTs to the local HTTP server on `127.0.0.1:60123` (see `src/rpc.rs`).

**Registered methods (Rust side):**

| Method | Returns | Notes |
|---|---|---|
| `ping` | `"pong"` | Health check |
| `getVersion` | `string` | Loader version from `Cargo.toml` |
| `isInjected` | `boolean` | Whether the bundle is active (live injection state) |

### `routes: RouteApi`

| Method | Signature | Notes |
|---|---|---|
| `addRoute` | `(path, component) => void` | Register a fullscreen route in Steam |
| `removeRoute` | `(path) => void` | Remove a registered route |

### `notifications?: NotificationsApi`

Optional. Sends a toast notification in the Steam UI.

| Method | Signature |
|---|---|
| `send` | `(title, body, timeout?) => void` |

### `platform: PlatformApi`

| Method | Signature | Notes |
|---|---|---|
| `getOSVersion` | `() => string` | OS version string |
| `checkCompatibility` | `() => boolean` | Basic environment sanity check |
| `navigateToApp` | `(appId: number) => void` | Navigate Steam UI to a game page |

### `qam: QamApi` *(added in 1.1.0)*

A dedicated panel with its own icon in the Steam Quick Access Menu.

| Method | Signature | Notes |
|---|---|---|
| `registerPanel` | `(panel: QamPanel) => () => void` | Adds the panel + icon; returns an unregister function |

`QamPanel = { id: string; title: string; icon: string /* inline SVG or data URI */; render(container: HTMLElement): void \| (() => void) }`.

Implemented in `runtime/shelves-host.js`: an always-working icon rail + slide-in
panel (works in the local harness and as a Steam overlay), with a seam
(`tryMountNative`) for a native Steam QAM tab pending on-device validation.

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

---

## Adding a new method

1. Add the signature to the relevant sub-interface in `contract.ts`.
2. Implement in `shelves.ts` (throw `notImplemented` until ready).
3. If the method calls into the Rust host, add the handler in `src/rpc.rs`'s
   `dispatch()` function.
4. Update this document.

The contract is **additive-only** — removing or changing existing signatures
requires a major version bump in `HOST_API_VERSION`.

---

## RPC wire format

The host RPC server (`127.0.0.1:60123`) is an HTTP/1.1 endpoint. The body of a
`POST` is `{ "method": ..., "args": ... }` and the response is JSON:

```
→ POST / {"method":"ping"}
← {"ok":true,"result":"pong"}

→ POST / {"method":"getVersion"}
← {"ok":true,"result":"0.1.0"}

→ POST / {"method":"unknown"}
← {"ok":false,"error":"unknown method: unknown"}
```

`ShelvesHostApi.rpc.call` wraps this in a `fetch` POST so the bundle does
not manage raw sockets.
