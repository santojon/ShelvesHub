#!/usr/bin/env python3
"""Fetch Valve's native ARM64 Linux Steam client into a Steam root.

Reads the client manifest Valve publishes for the `linuxarm64` platform, downloads
the client package (the one the first launch bootstraps the rest from), verifies
its SHA-256 and unpacks it. The archive names entries with backslashes under a
`steamrtarm64\\` prefix, so a plain unzip would create literal backslash names.

Usage: fetch-client.py <steam root> [stable|publicbeta]
Prints the manifest version it pinned; skips the download when the client program
is already in place.
"""
from __future__ import annotations

import hashlib
import os
import re
import stat
import sys
import urllib.request
import zipfile

CDN = "https://client-update.steamstatic.com"
PACKAGE = "bins_linuxarm64_linuxarm64"
PROGRAM = os.path.join("steamrtarm64", "steam")


def manifest_url(channel: str) -> str:
    suffix = "_publicbeta_linuxarm64" if channel == "publicbeta" else "_linuxarm64"
    return f"{CDN}/steam_client{suffix}"


def read(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def pick(manifest: str, name: str) -> tuple[str, str]:
    block = re.search(r'"%s"\s*\{(.*?)\}' % re.escape(name), manifest, re.S)
    if not block:
        raise SystemExit(f"package {name} not in the manifest")
    file = re.search(r'"file"\s+"([^"]+)"', block.group(1)).group(1)
    sha2 = re.search(r'"sha2"\s+"([0-9a-f]+)"', block.group(1)).group(1)
    return file, sha2


def unpack(zpath: str, root: str) -> int:
    n = 0
    with zipfile.ZipFile(zpath) as z:
        for info in z.infolist():
            name = info.filename.replace("\\", "/")
            if name.endswith("/") or name.startswith("/") or ".." in name.split("/"):
                continue
            dst = os.path.join(root, name)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with z.open(info) as src, open(dst, "wb") as out:
                out.write(src.read())
            mode = info.external_attr >> 16
            if mode:
                os.chmod(dst, mode & 0o755)
            n += 1
    return n


def main() -> int:
    root = sys.argv[1]
    channel = sys.argv[2] if len(sys.argv) > 2 else "stable"
    os.makedirs(root, exist_ok=True)
    manifest = read(manifest_url(channel)).decode("utf-8", "replace")
    version = re.search(r'"version"\s+"(\d+)"', manifest).group(1)
    print(f"manifest {channel} version {version}")
    program = os.path.join(root, PROGRAM)
    if os.path.exists(program):
        print("client already in place, nothing to fetch")
        return 0
    file, sha2 = pick(manifest, PACKAGE)
    zpath = os.path.join(root, "client.zip")
    print(f"downloading {file}")
    data = read(f"{CDN}/{file}")
    if hashlib.sha256(data).hexdigest() != sha2:
        raise SystemExit("client package failed its SHA-256 check")
    with open(zpath, "wb") as out:
        out.write(data)
    print(f"unpacked {unpack(zpath, root)} files")
    os.remove(zpath)
    st = os.stat(program)
    os.chmod(program, st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
