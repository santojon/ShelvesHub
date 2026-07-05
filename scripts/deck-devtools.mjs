#!/usr/bin/env node
// Cross-platform wrapper for the shelves-devtools CDP tasks. Reads
// DECK_CDP_HOST / DECK_CDP_PORT from the environment (dotenv-cli injects them
// from .env) and runs the Rust devtools binary — replacing the `sh -c '...'`
// one-liners so `pnpm run deck:*` works natively on Windows too.
//
// Usage: node scripts/deck-devtools.mjs <subcommand> [args...]
import { spawnSync } from "node:child_process";

const host = process.env.DECK_CDP_HOST;
const port = process.env.DECK_CDP_PORT;
if (!host || !port) {
  console.error("[deck-devtools] DECK_CDP_HOST / DECK_CDP_PORT not set (check .env).");
  process.exit(1);
}

const passthrough = process.argv.slice(2);
const args = [
  "run", "--quiet", "--bin", "shelves-devtools", "--",
  "--host", host, "--port", port,
  ...passthrough,
];

const res = spawnSync("cargo", args, { stdio: "inherit" });
if (res.error) {
  console.error(`[deck-devtools] failed to run cargo: ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status === null ? 1 : res.status);
