#!/usr/bin/env node
// Wrapper for the shelves-devtools CDP tasks against the LOCAL Steam Big Picture (counterpart to
// deck-devtools.mjs). Reads LOCAL_CEF_HOST / LOCAL_CEF_PORT (default 127.0.0.1:8080) — never
// SHELVES_CEF_*, which .env may point at a Deck. Usage: node scripts/local-devtools.mjs <cmd>...
import { spawnSync } from "node:child_process";

const host = process.env.LOCAL_CEF_HOST || "127.0.0.1";
const port = process.env.LOCAL_CEF_PORT || "8080";

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
