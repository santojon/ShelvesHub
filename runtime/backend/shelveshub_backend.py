#!/usr/bin/env python3
"""ShelvesHub backend runner.

Hosts a plugin data backend (a directory with `main.py` exposing a `Plugin`
class) as a child process of the ShelvesHub daemon, and serves its public
methods over a line-delimited JSON protocol on stdio. The runner is fully
self-contained: it depends only on the Python standard library and offers
the backend a neutral host environment — no third-party loader modules are
provided or emulated.

Spawned by the daemon with:
  SHELVES_BACKEND_DIR    directory containing the backend (main.py etc.)
  SHELVES_SETTINGS_DIR   where the backend should keep its settings; exported
                         to the backend process as DECK_SHELVES_SETTINGS_DIR

Host environment offered to the backend:
  - env DECK_SHELVES_SETTINGS_DIR — settings directory, created beforehand;
  - stderr — free-form log sink, forwarded line by line into the daemon log;
  - class contract — `main.Plugin`, public async/sync methods, optional
    `_main()` / `_unload()` lifecycle hooks called at start / shutdown.

Protocol (one JSON object per line on stdio):
  request:  {"id": <int>, "method": "<name>", "args": <object|array|null>}
  response: {"id": <int>, "ok": true,  "result": <any>}
          | {"id": <int>, "ok": false, "error": "<message>"}

Dispatch convention: an object is applied as keyword arguments, an array as
positional arguments, null as no arguments. Names starting with "_" are
never callable remotely.

stdout is reserved for the protocol: the original fd 1 is duplicated for
protocol writes and then redirected to stderr, so any stray print() in
backend code cannot corrupt the channel.
"""
import asyncio
import inspect
import json
import logging
import os
import sys

RUNNER_DIR = os.path.dirname(os.path.abspath(__file__))

_handler = logging.StreamHandler(sys.stderr)
_handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
log = logging.getLogger("shelveshub-backend")
log.setLevel(logging.INFO)
log.addHandler(_handler)
log.propagate = False


def _default_settings_dir() -> str:
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
        return os.path.join(base, "deck-shelves")
    if sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~"), "Library", "Application Support", "deck-shelves")
    base = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(base, "deck-shelves")


def _fatal(message: str) -> None:
    log.error(message)
    sys.exit(2)


BACKEND_DIR = os.environ.get("SHELVES_BACKEND_DIR", "")
if not BACKEND_DIR or not os.path.isfile(os.path.join(BACKEND_DIR, "main.py")):
    _fatal(f"SHELVES_BACKEND_DIR does not contain main.py: {BACKEND_DIR!r}")

SETTINGS_DIR = os.environ.get("SHELVES_SETTINGS_DIR") or _default_settings_dir()
os.makedirs(SETTINGS_DIR, exist_ok=True)
# The one switch that points the backend at the ShelvesHub settings store.
# The backend's storage layer must honour this env var first.
os.environ["DECK_SHELVES_SETTINGS_DIR"] = SETTINGS_DIR

# Reserve fd 1 for the protocol, then route stdout (and stray print()s in
# backend code) to stderr, where the daemon forwards them to its log.
_proto = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr

sys.path.insert(0, BACKEND_DIR)
try:
    import main as _backend_main  # noqa: E402
except Exception as e:  # ImportError included — report cleanly, never trace-dump
    _fatal(
        f"backend failed to import ({e}). The backend must run on the "
        "standard library plus its own modules — no loader-specific imports; "
    )

if not hasattr(_backend_main, "Plugin"):
    _fatal("backend main.py does not define a Plugin class")

_plugin = _backend_main.Plugin()


def _send(payload) -> None:
    _proto.write(json.dumps(payload, default=str) + "\n")
    _proto.flush()


def _reply_error(rid, message: str) -> None:
    _send({"id": rid, "ok": False, "error": str(message)})


def _callable_method(name):
    """Resolve a remotely-callable Plugin method or return None."""
    if not isinstance(name, str) or not name or name.startswith("_"):
        return None
    fn = getattr(_plugin, name, None)
    return fn if callable(fn) else None


async def _invoke(fn, args):
    if args is None:
        result = fn()
    elif isinstance(args, dict):
        result = fn(**args)
    elif isinstance(args, list):
        result = fn(*args)
    else:
        result = fn(args)
    if inspect.isawaitable(result):
        result = await result
    return result


async def _handle(request) -> None:
    rid = request.get("id")
    method = request.get("method")
    fn = _callable_method(method)
    if fn is None:
        _reply_error(rid, f"unknown method: {method}")
        return
    try:
        result = await _invoke(fn, request.get("args"))
        _send({"id": rid, "ok": True, "result": result})
    except TypeError as e:
        _reply_error(rid, f"bad arguments for {method}: {e}")
    except Exception as e:  # backend errors must never kill the runner
        log.error(f"{method} raised: {e}")
        _reply_error(rid, f"{method} failed: {e}")


async def _serve() -> None:
    if hasattr(_plugin, "_main"):
        try:
            await _invoke(getattr(_plugin, "_main"), None)
        except Exception as e:
            log.error(f"_main failed: {e}")

    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:  # EOF — the daemon is gone; unload and exit.
            break
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError:
            _send({"id": None, "ok": False, "error": "invalid request json"})
            continue
        await _handle(request)

    if hasattr(_plugin, "_unload"):
        try:
            await _invoke(getattr(_plugin, "_unload"), None)
        except Exception as e:
            log.error(f"_unload failed: {e}")


if __name__ == "__main__":
    log.info(f"backend runner starting (settings dir: {SETTINGS_DIR})")
    asyncio.run(_serve())
