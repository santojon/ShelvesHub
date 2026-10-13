"""Example backend for the ShelvesHub runner.

A minimal, dependency-free `Plugin` used to exercise the full data-RPC
pipeline (renderer → daemon → runner → Python) without any external
project. Run it through the daemon with:

  SHELVES_BACKEND_DIR=examples/backend cargo run --bin shelveshub

Then, from any HTTP client. The RPC needs the daemon's per-boot bearer token
(the `.rpc-token` file in its per-user install directory: `~/.local/share/shelveshub`
on Linux/macOS, `%LOCALAPPDATA%\\shelveshub` on Windows) and a JSON content type,
and only the methods on the daemon's allowlist (`BACKEND_METHODS` in src/rpc.rs)
reach the backend — `get_settings` and `set_settings` are on it; `echo` and
`boom` only exercise the runner (an answer, a raised error) and are refused
over RPC:

  TOKEN="$(cat ~/.local/share/shelveshub/.rpc-token)"
  curl -X POST 127.0.0.1:60123 \\
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
    -d '{"method":"get_settings","args":{}}'
"""
import json
import os


class Plugin:
    started = False

    async def _main(self):
        # Lifecycle hook: called once by the runner before serving requests.
        Plugin.started = True
        print("example backend started")  # lands on stderr via the runner

    async def _unload(self):
        print("example backend unloaded")

    async def echo(self, value=None, *args, **kwargs):
        return {"echo": value}

    async def get_settings(self, *args, **kwargs):
        path = os.path.join(os.environ.get("DECK_SHELVES_SETTINGS_DIR", "."), "settings.json")
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
        return {"enabled": False}

    async def set_settings(self, settings=None, *args, **kwargs):
        if not isinstance(settings, dict):
            return False
        path = os.path.join(os.environ.get("DECK_SHELVES_SETTINGS_DIR", "."), "settings.json")
        with open(path, "w") as f:
            json.dump(settings, f)
        return True

    async def boom(self, *args, **kwargs):
        raise RuntimeError("intentional example failure")
