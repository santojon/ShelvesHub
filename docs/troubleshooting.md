# Troubleshooting

Most issues come down to a **port conflict**, **another host on the same machine**,
or a **collapsed Steam UI**. Nearly all are fixable from the config file —
`shelveshub.config.json`, installed next to the binary — without a rebuild.

## The config file

Precedence per setting is **environment variable > config file > built-in default**.
Edit `shelveshub.config.json` (or point `SHELVES_CONFIG_FILE` at another path), then
restart the ShelvesHub service. Every key is documented inline in the file; remove a
key to fall back to its default.

## Port conflicts

### The RPC port (60123) is already in use

Symptom: the log shows `Failed to bind 127.0.0.1:60123`. Another program holds the
port. Fix — pick a free port:

```json
{ "rpc_port": 60124 }
```

The injected runtime uses the same port automatically (the daemon stamps it in), so
you only change it in one place.

### Steam's debug port (8080) is wrong or unreachable

Symptom: repeated `Injection cycle skipped: … Connection refused` on
`127.0.0.1:8080`. Steam's CEF remote-debugging endpoint isn't reachable there. First
make sure it is enabled — `~/.steam/steam/.cef-enable-remote-debugging` exists and
Steam was fully restarted afterwards. If it listens on a different port, set it:

```json
{ "cef_port": 8081 }
```

You can also move the host with `cef_host` if debugging a remote endpoint.

## Another host on the same machine (coexistence)

ShelvesHub coexists with another host (for example another plugin loader): it
never loads the plugin twice and adds only its own tab. Two knobs:

- **It hijacked a plugin the other host was about to load.** Give the other host
  time to claim the renderer first:

  ```json
  { "owner_settle_secs": 25 }
  ```

- **You want ShelvesHub to be the host** even when another is installed:

  ```json
  { "force_owner": true }
  ```

## Black screen / collapsed Steam UI

If the Steam UI ever collapses, the daemon **pauses injection** (it never
force-restarts Steam — that makes it worse) and logs a recovery hint. To recover
automatically, set the command for your platform — for example on a Steam Deck:

```json
{ "recover_cmd": "systemctl --user restart steam-launcher.service" }
```

## The native tab

The native Quick Access tab is controlled by `native_qam` (or `SHELVES_NATIVE_QAM=1`
per service). Set it to `false` to fall back to the on-screen panel.

## Reading the log

```
journalctl --user -u shelveshub -f      # SteamOS / Linux user service
```

Every error path writes a log line, so the log is the first place to look.
