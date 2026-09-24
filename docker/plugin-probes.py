#!/usr/bin/env python3
"""Exercise the Deck Shelves plugin's cross-OS backend probes under the ShelvesHub
harness.

ShelvesHub HOSTS the plugin's Python backend, so its OS-coupled probes — external
display / dock, hardware, host-OS identity, Steam library locations, performance,
peripherals, external launchers — should get real CI coverage on THIS container's
OS/arch (Linux, and ARM64 via the harness's `PLATFORM=linux/arm64`), not only the
plugin repo's own x86_64 GitHub runner. The contract each probe must honour is
**fail-soft**: it returns a value on any OS and never raises off its native one.
This runner imports the real backend and asserts exactly that — a raised
exception is a failure; the returned value is informational.

The plugin backend is found via `DECK_SHELVES_ROOT` (default: a sibling
`../Deck-Shelves` checkout). If it isn't present the runner exits 0 with a skip
note, so the host-only harness still runs where the plugin isn't checked out.
"""
from __future__ import annotations

import importlib
import json
import os
import sys


def find_backend() -> str | None:
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.environ.get("DECK_SHELVES_ROOT", ""),
        os.path.join(here, "..", "..", "Deck-Shelves"),
        "/deck-shelves",
    ]
    for root in candidates:
        if root and os.path.isdir(os.path.join(root, "src", "backend")):
            return os.path.join(root, "src", "backend")
    return None


# (module, arg-free callable) — every probe must RETURN on any OS, never raise.
PROBES = [
    ("display_state", "read_display_state"),
    ("hardware_info", "get_hardware_info"),
    ("host_os", "get_host_os"),
    ("library_location", "get_library_locations"),
    ("perf_probe", "read_perf_snapshot"),
    ("peripherals", "get_bluetooth_state"),
    ("peripherals", "get_audio_state"),
    ("launchers", "list_available_launchers"),
]


def main() -> int:
    backend = find_backend()
    if not backend:
        print("[plugin-probes] Deck-Shelves backend not found (set DECK_SHELVES_ROOT) — skipping.")
        return 0

    sys.path.insert(0, backend)
    arch = os.uname().machine if hasattr(os, "uname") else "?"
    print(f"[plugin-probes] backend: {backend}  ({sys.platform} / {arch})")

    fail = 0
    for mod_name, fn_name in PROBES:
        try:
            mod = importlib.import_module(mod_name)
            result = getattr(mod, fn_name)()
            preview = json.dumps(result, default=str)[:90]
            print(f"  [ok] {mod_name}.{fn_name}() -> {type(result).__name__} {preview}")
        except Exception as exc:  # noqa: BLE001 — a raised probe IS the failure here
            print(f"  [X] {mod_name}.{fn_name}() raised {type(exc).__name__}: {exc}")
            print("      (probes must be fail-soft — return on every OS, never raise)")
            fail = 1

    print("[plugin-probes] " + ("all probes fail-soft OK" if not fail else "FAILURES above"))
    return fail


if __name__ == "__main__":
    sys.exit(main())
