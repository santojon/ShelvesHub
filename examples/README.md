# Examples — local debug bundle & CEF harness

These files let you exercise the loader's injection path and the host RPC server
**without a Steam Deck**, against a locally-launched Chromium (which speaks the
same DevTools protocol as Steam's CEF renderer).

| File | Role |
|---|---|
| `bundle/shelves-example.js` | A framework-free stand-in for the real Deck Shelves bundle. Reads `window.__SHELVES_HOST__`, registers lifecycle, calls `ping` / `getVersion` / `isInjected` over RPC, renders sample shelves, and sets `window.__SHELVES_DEMO__`. |
| `harness/index.html` | A page that mimics the Steam renderer DOM. Has a `#shelves-root` mount point. |
| `harness/steam-stubs.js` | Provides `window.SteamClient` and a local `window.__SHELVES_HOST__` (whose `rpc.call` talks to the real host RPC server, mirroring `src/runtime/host/shelves.ts`). |

## Quick start

```bash
scripts/local-debug.sh          # Linux/macOS
scripts/local-debug.ps1         # Windows (PowerShell)
```

The script launches Chromium with remote debugging, runs the loader against it,
injects `bundle/shelves-example.js`, and prints the verification output. See
[../docs/debugging.md](../docs/debugging.md) for the full walkthrough and the
manual `shelves-devtools` commands.
