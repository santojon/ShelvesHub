# Development

## Task runner (pnpm)

`pnpm` is the single entry point for the whole project — it installs the
toolchain, builds/runs the Rust binaries, drives the local debug harness, and
deploys/debugs against a Steam Deck. You only need [Homebrew](https://brew.sh)
and pnpm to start; `pnpm setup` installs the rest.

```bash
pnpm setup           # one-time: install rustup+target, zig+cargo-zigbuild,
                     # Chromium, JS deps, and create .env (macOS / Homebrew)
pnpm update          # update the managed toolchain + deps

pnpm build           # cargo build (loader + shelves-devtools)
pnpm build:release   # release build
pnpm test            # cargo test
pnpm lint            # cargo clippy -- -D warnings  (same as CI)
pnpm run             # run the loader locally
pnpm devtools targets      # run shelves-devtools (args follow directly)

pnpm debug:local     # full end-to-end run against a local browser (no Deck)

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

The binary is output to `target/release/loader` (or `target/debug/loader`).

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

The resulting binary at `target/x86_64-unknown-linux-gnu/release/loader` can be rsync'd directly to the Deck.

## SSH deploy workflow

Create a `.env` (or `.env.local`) in the project root:

```ini
DECK_HOST=deck.local
DECK_USER=deck
DECK_SSH_KEY=~/.ssh/id_rsa
DECK_DEPLOY_PATH=/home/deck/shelves-loader-dev
```

Deploy and restart:

```bash
set -o allexport; source .env; set +o allexport

# Sync project
rsync -av --exclude .git --exclude target \
  ./ $DECK_USER@$DECK_HOST:$DECK_DEPLOY_PATH

# Copy pre-built binary and restart (build must be done locally first)
ssh -i "$DECK_SSH_KEY" $DECK_USER@$DECK_HOST \
  "cp $DECK_DEPLOY_PATH/target/x86_64-unknown-linux-gnu/release/loader \
       $HOME/.local/share/shelves-loader/loader && \
   systemctl --user restart shelves-loader"
```

## Checking the service on the Deck

```bash
ssh deck@deck.local
systemctl --user status shelves-loader
journalctl --user -u shelves-loader -f
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
