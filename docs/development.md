# Development

## Prerequisites

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

Once the loader is running, probe the RPC endpoint from the Deck or from your dev machine (if SSH-forwarded):

```bash
echo '{"method":"ping"}' | nc 127.0.0.1 60123
echo '{"method":"getVersion"}' | nc 127.0.0.1 60123
echo '{"method":"isInjected"}' | nc 127.0.0.1 60123
```

## CI

The CI workflow (`.github/workflows/ci.yml`) runs `cargo check`, `cargo test`, and `cargo clippy -- -D warnings` on every push and pull request. Build artifacts are generated on PR merge and on tag push. See `.github/workflows/` for the full workflow definitions.
