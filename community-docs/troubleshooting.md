# Troubleshooting ShelvesHub

*[Leia em português](pt-BR/troubleshooting.md)*

Most issues come down to a **port conflict**, **another host on the same
machine**, or a **collapsed Steam UI**. Nearly all are fixable from the config
file — `shelveshub.config.json`, installed next to the binary — or the editable
Configuration section of the ShelvesHub tab, without reinstalling.

## Nothing shows up after installing

Restart Steam **completely** — the actual client, not just the game.
ShelvesHub injects when it catches Steam on launch, so it needs a fresh start
to take effect the first time.

## The config file

Precedence per setting is **environment variable > config file > built-in
default**. Edit `shelveshub.config.json` (or point `SHELVES_CONFIG_FILE` at
another path) and restart the service. Every key is documented inline; remove a
key to fall back to its default.

## Port conflicts

**The local RPC port (60123) is already in use.** The log shows
`Failed to bind 127.0.0.1:60123`. Pick a free port — the injected runtime
picks it up automatically:

```json
{ "rpc_port": 60124 }
```

**Steam's debug port is wrong or unreachable.** The log shows repeated
`Connection refused` on `127.0.0.1:8080`. First make sure Steam's debugging is
enabled (`~/.steam/steam/.cef-enable-remote-debugging` exists and Steam was
fully restarted afterwards). If it listens elsewhere:

```json
{ "cef_port": 8081 }
```

## Another host on the same machine

ShelvesHub coexists with another plugin host — it never loads Deck Shelves
twice and adds only its own tab. If it grabbed a plugin the other host was
about to load, give the other host time to claim the interface first:

```json
{ "owner_settle_secs": 25 }
```

Full details in [coexistence.md](coexistence.md).

## Black screen / collapsed Steam UI

If the Steam UI ever collapses, ShelvesHub **pauses injection** — it never
force-restarts Steam, which only makes it worse — and, on a confirmed black
screen, runs a recovery step for your platform (restarting the Deck's Game Mode
session, or bringing Steam back into Big Picture on desktop). You can override
the recovery command:

```json
{ "recover_cmd": "systemctl --user restart steam-launcher.service" }
```

## Turn the host off without uninstalling

The ShelvesHub tab has a **disable until restart** switch — it stands the host
down until the next service restart, without removing anything. Useful for
isolating whether ShelvesHub is involved in a problem.

## The native tab

The native Quick Access tab is controlled by `native_qam` (or
`SHELVES_NATIVE_QAM=1`). Set it to `false` to fall back to the on-screen panel.

## Reading the log

The merged log lives in the ShelvesHub tab's log viewer. From a terminal on
SteamOS / Linux:

```bash
journalctl --user -u shelveshub -f
```

Every error path writes a log line, so the log is the first place to look —
and the best thing to attach to a bug report.
