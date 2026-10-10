#!/usr/bin/env node
// Cross-platform wrapper for the shelves-devtools CDP tasks against the LOCAL Steam Big Picture
// (desktop counterpart to deck-devtools.mjs). Reads SHELVES_CEF_HOST / SHELVES_CEF_PORT (default
// 127.0.0.1:8080) and runs the Rust devtools binary. Usage: node scripts/local-devtools.mjs <cmd>...
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
