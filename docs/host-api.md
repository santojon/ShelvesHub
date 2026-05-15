# HostApi — Contract Reference

Contract version: **1.0.0** (additive-only after this baseline).

The `HostApi` interface defines what the Shelves Loader host process provides
to the Deck Shelves bundle. The bundle receives this object as
`window.__SHELVES_HOST__` at startup.

The concrete implementation in this repository is `ShelvesHostApi`
(`src/runtime/host/shelves.ts`). The Deck Shelves repository builds its
bundle to consume this contract.

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

`call` POSTs to the local TCP server on `127.0.0.1:60123` (see `src/rpc.rs`).

**Registered methods (Rust side):**

| Method | Returns | Notes |
|---|---|---|
| `ping` | `"pong"` | Health check |
| `getVersion` | `string` | Loader version from `Cargo.toml` |
| `isInjected` | `boolean` | Whether the bundle is active (stub — always `false`) |

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

The TCP server (`127.0.0.1:60123`) speaks newline-delimited JSON:

```
→ {"method":"ping"}
← {"ok":true,"result":"pong"}

→ {"method":"getVersion"}
← {"ok":true,"result":"0.1.0"}

→ {"method":"unknown"}
← {"ok":false,"error":"unknown method"}
```

`ShelvesHostApi.rpc.call` wraps this in a `fetch` POST so the bundle does
not manage raw sockets.
