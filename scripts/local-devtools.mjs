#!/usr/bin/env node
// Cross-platform wrapper for the shelves-devtools CDP tasks against the LOCAL
// Steam Big Picture (the desktop counterpart to deck-devtools.mjs, which targets
// a Deck over the LAN). Reads SHELVES_CEF_HOST / SHELVES_CEF_PORT (default
// 127.0.0.1:8080 — Steam's own localhost debug port) and runs the same Rust
// devtools binary, so `pnpm run local:*` works natively on macOS, Windows and
// Linux.
//
// Usage: node scripts/local-devtools.mjs <subcommand> [args...]
import { spawnSync } from "node:child_process";

const host = process.env.SHELVES_CEF_HOST || "127.0.0.1";
const port = process.env.SHELVES_CEF_PORT || "8080";

const passthrough = process.argv.slice(2);
const args = [
  "run", "--quiet", "--bin", "shelves-devtools", "--",
  "--host", host, "--port", port,
  ...passthrough,
];

const res = spawnSync("cargo", args, { stdio: "inherit" });
if (res.error) {
  console.error(`[local-devtools] failed to run cargo: ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status === null ? 1 : res.status);
