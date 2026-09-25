# Development

*[Leia em português](pt-BR/development.md)*

## Task runner (pnpm)

`pnpm` is the single entry point for the whole project — it installs the
toolchain, builds/runs the Rust binaries, drives the local debug harness, and
deploys/debugs against a Steam Deck. `pnpm setup` bootstraps the toolchain on
**macOS, Linux/SteamOS, and Windows**; you only need Node + pnpm to start.

```bash
pnpm setup           # one-time toolchain install, auto-dispatched per OS:
                     #   macOS   → Homebrew (rustup, zig+cargo-zigbuild, Chromium)
                     #   Linux   → rustup.rs + Corepack (SteamOS/Arch/Ubuntu/Fedora/…)
                     #   Windows → winget/rustup + Corepack
                     # then adds the Deck target, installs JS deps, creates .env
pnpm update          # update the managed toolchain + deps

pnpm build           # cargo build (loader + shelves-devtools)
pnpm build:release   # release build
pnpm test            # cargo test
pnpm lint            # cargo clippy -- -D warnings  (same as CI)
pnpm run             # run the loader locally
pnpm devtools targets      # run shelves-devtools (args follow directly)

pnpm debug:local     # full end-to-end run against a throwaway Chromium (no Steam)

# Local Steam Big Picture (real sole-host, this machine — macOS/Windows/Linux)
pnpm local:run          # build + run the daemon against local Steam, seed bundle if missing
pnpm local:run:reseed   # re-seed the bundle from the plugin build, then reload the renderer
pnpm local:stop         # stop the local daemon
pnpm local:targets      # list CEF targets on local Steam
pnpm local:reload       # reload the local renderer (re-inject the current bundle)
pnpm local:console      # stream the local renderer console
pnpm local:eval '<js>'  # evaluate JS in the local renderer

# Steam Deck (reads .env) — see docs/debugging.md
pnpm build:deck      # cross-compile the loader for SteamOS
pnpm deck:deploy     # build + deploy + run on the Deck over SSH
pnpm deck:tunnel     # forward the Deck's CEF port to localhost
pnpm deck:logs       # tail the service logs on the Deck
pnpm deck:targets    # list CEF targets on the Deck (needs deck:tunnel running)
pnpm deck:inject     # inject bundle/index.js into the Deck renderer
pnpm deck:reload     # reload the Deck renderer
pnpm deck:console    # stream the Deck renderer console
pnpm deck:reinject   # clear markers so the loader re-injects an updated runtime/bundle
```

### Supported platforms

The core dev loop — `setup`, `build`, `build:release`, `test`, `lint`, `fmt`,
`run`, `devtools`, `clean`, `debug:local`, the `local:*` tasks, and the `deck:*`
CDP tasks — runs natively on **Windows, macOS, SteamOS, and other Linux** (all
CDP tasks go through small Node wrappers — `scripts/local-devtools.mjs` for local
Steam, `scripts/deck-devtools.mjs` for a Deck — and `debug:local` dispatches to
`local-debug.sh` / `local-debug.ps1`). The SSH-deploy and cross-compile tasks
(`build:deck`, `deck:deploy`, `deck:tunnel`, `deck:logs`) are bash and target a
Linux Deck — on Windows run them under WSL / Git Bash.

### Three test paths

| Path | Command | What it exercises |
|---|---|---|
| **Chromium harness** | `pnpm debug:local` | The inject + RPC path against a throwaway browser — fast, no Steam, no Deck. |
| **Local Steam (real Big Picture)** | `pnpm local:run` | The daemon as the **sole host** injecting into *this machine's* Steam Big Picture — the real desktop path on macOS/Windows/Linux. |
| **Steam Deck (over SSH)** | `pnpm deck:deploy` | The full on-device path (cross-compiled binary, systemd service, coexist with a plugin loader). |

**Local Steam** is the closest desktop analogue to on-device testing. It needs
Steam launched with CEF remote debugging and Big Picture open:

- **macOS:** `open -a Steam --args -cef-enable-remote-debugging`
- **Windows:** launch `steam.exe -cef-enable-remote-debugging`
- **Linux:** `touch ~/.steam/steam/.cef-enable-remote-debugging` then restart Steam

**The plugin does not need to be checked out.** By default the daemon's own
`ensure_bundle` downloads the latest Deck Shelves release into a managed bundle
(exactly what a real install does), so `pnpm local:run` works from a clean hub
clone alone — add `--prerelease` (`node scripts/local-run.mjs --prerelease`) to
track the beta channel. If a sibling plugin checkout is present
(`../Deck-Shelves/dist/index.iife.js`) or `SHELVES_BUNDLE_PATH` points at a build,
that local bundle is seeded instead — for co-developing the hub and plugin
together. This is why we do **not** vendor the plugin as a submodule: the hub only
needs the built bundle (a release asset), never the plugin's source tree.

`local:run` builds the daemon and starts it against
`SHELVES_CEF_HOST:SHELVES_CEF_PORT` (default `127.0.0.1:8080` — Steam's own
localhost debug port). Like the product's `ensure_bundle`, an existing managed
bundle is kept across restarts (so a self-installed or previously-fetched build
survives); `local:run:reseed` forces a refresh and reloads the renderer. The
managed bundle and daemon log live under the OS data dir
(`~/Library/Application Support/shelveshub-dev/` on macOS,
`%APPDATA%\shelveshub-dev\` on Windows, `$XDG_DATA_HOME/shelveshub-dev/` on Linux).

Connection and CDP settings live in `.env`. The `deck:*` tasks connect directly
to `DECK_CDP_HOST:DECK_CDP_PORT` (no tunnel needed when the Deck's CEF port is
reachable on your LAN; note Steam's `8080` is localhost-only, so a different port
like `8081` is used over the network). See `.env.example`.

## Prerequisites (manual, without pnpm)

- [Rust](https://rustup.rs) (stable toolchain)
- A Steam Deck or SteamOS machine for testing (SSH access)
- `rsync` for remote deployment

## Building locally

```bash
cargo build          # debug build
cargo build --release  # release build
cargo test           # run tests
cargo clippy -- -D warnings  # lint (same flags as CI)
```

The binary is output to `target/release/shelveshub` (or `target/debug/shelveshub`).

## Cross-compiling for SteamOS (x86_64 Linux)

SteamOS has a read-only filesystem and limited tooling — build locally and deploy the binary:

```bash
# Add the Linux target (if not already present)
rustup target add x86_64-unknown-linux-gnu

# On macOS you need a cross-linker — install via Homebrew:
brew install FiloSottile/musl-cross/musl-cross

# Build for SteamOS
CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-musl-gcc \
  cargo build --release --target x86_64-unknown-linux-gnu
```

The resulting binary at `target/x86_64-unknown-linux-gnu/release/shelveshub` can be rsync'd directly to the Deck.

## SSH deploy workflow

Create a `.env` (or `.env.local`) in the project root:

```ini
DECK_HOST=deck.local
DECK_USER=deck
DECK_SSH_KEY=~/.ssh/id_rsa
DECK_DEPLOY_PATH=/home/deck/shelveshub-dev
```

Deploy and restart:

```bash
set -o allexport; source .env; set +o allexport

# Sync project
rsync -av --exclude .git --exclude target \
  ./ $DECK_USER@$DECK_HOST:$DECK_DEPLOY_PATH

# Copy pre-built binary and restart (build must be done locally first)
ssh -i "$DECK_SSH_KEY" $DECK_USER@$DECK_HOST \
  "cp $DECK_DEPLOY_PATH/target/x86_64-unknown-linux-gnu/release/shelveshub \
       $HOME/.local/share/shelveshub/shelveshub && \
   systemctl --user restart shelveshub"
```

## Checking the service on the Deck

```bash
ssh deck@deck.local
systemctl --user status shelveshub
journalctl --user -u shelveshub -f
```

## Testing the RPC server

The host RPC server speaks HTTP (the bundle reaches it with `fetch` from inside
the renderer). Once the loader is running, probe it from the Deck or from your
dev machine (if SSH-forwarded):

```bash
curl -s 127.0.0.1:60123 -d '{"method":"ping"}'
curl -s 127.0.0.1:60123 -d '{"method":"getVersion"}'
curl -s 127.0.0.1:60123 -d '{"method":"isInjected"}'
```

## Debugging the injection / DevTools

See [debugging.md](debugging.md) for the `shelves-devtools` CDP tool, the local
debug harness (`scripts/local-debug.sh`), and the on-Deck SSH workflow
(`scripts/deck-deploy.sh`, `scripts/deck-tunnel.sh`).

## CI

The CI workflow (`.github/workflows/ci.yml`) runs `cargo check`, `cargo test`, and `cargo clippy -- -D warnings` on every push and pull request. Build artifacts are generated on PR merge and on tag push. See `.github/workflows/` for the full workflow definitions.
