# Development: Running and debugging on a Steam Deck via SSH

This guide shows a minimal workflow to develop and test Shelves Loader remotely on a Steam Deck over SSH. The approach uses a small `.env` file to hold connection details so the same commands work across supported platforms.

## Prerequisites
- A Steam Deck with developer SSH enabled (or another test machine)
- `ssh` and `rsync` installed on your development machine

## .env example
Create a `.env` (or `.env.local`) in the project root with these values:

```ini
# Host or IP of the Steam Deck
DECK_HOST=deck.local
# SSH user
DECK_USER=deck
# Optional path on the device where project will be deployed
DECK_DEPLOY_PATH=/home/deck/shelves-loader-dev
# Path to private key (optional)
DECK_SSH_KEY=~/.ssh/id_rsa
```

## One-line deploy and run (local -> deck)
Replace variables or load the env file with `set -o allexport; source .env; set +o allexport`.

```bash
# Copy project to the device
rsync -av --exclude .git --exclude target ./ $DECK_USER@$DECK_HOST:$DECK_DEPLOY_PATH

# Build and run remotely (example for a cargo build)
ssh -i "$DECK_SSH_KEY" $DECK_USER@$DECK_HOST "cd $DECK_DEPLOY_PATH && cargo build --release && sudo systemctl restart shelves-loader"
```

Notes:
- Adjust commands if you prefer using a container or cross-compile toolchain.
- For iterative development, copy only the changed artifacts (e.g., the compiled binary) to shorten the loop.

## Optional: using a sudo password from `.env`
If you set `DECK_SUDO_PASS` in your local `.env`, you can pipe it to `sudo` when running remote commands. Storing passwords in files is discouraged — prefer SSH key authentication and configuring `sudo` without a password for your development account.

Example using `DECK_SUDO_PASS` (careful with logs/history):

```bash
# Load env, then use password with sudo on the remote host
set -o allexport; source .env; set +o allexport
ssh -i "$DECK_SSH_KEY" $DECK_USER@$DECK_HOST "cd $DECK_DEPLOY_PATH && echo \"$DECK_SUDO_PASS\" | sudo -S systemctl restart shelves-loader"
```

