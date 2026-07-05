#!/usr/bin/env node
// Cross-platform launcher for the local debug harness: runs the PowerShell
// script on Windows and the bash script elsewhere, so `pnpm run debug:local`
// works on Windows, macOS, and Linux.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const forward = process.argv.slice(2);

const [cmd, args] =
  process.platform === "win32"
    ? ["powershell", ["-ExecutionPolicy", "Bypass", "-File", join(scriptsDir, "local-debug.ps1"), ...forward]]
    : ["bash", [join(scriptsDir, "local-debug.sh"), ...forward]];

const res = spawnSync(cmd, args, { stdio: "inherit" });
if (res.error) {
  console.error(`[debug:local] failed to launch ${cmd}: ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status === null ? 1 : res.status);
