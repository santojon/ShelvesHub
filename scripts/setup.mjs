#!/usr/bin/env node
// Cross-platform toolchain setup dispatcher. Picks the right per-OS installer so
// `pnpm setup` / `pnpm update` work on macOS, Linux/SteamOS, and Windows:
//   macOS   → scripts/mac-setup.sh   (Homebrew)
//   Linux   → scripts/linux-setup.sh (rustup.rs + corepack)
//   Windows → scripts/win-setup.ps1  (winget/rustup + corepack)
// Pass --update to also upgrade what it manages.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const forward = process.argv.slice(2);

let cmd, args;
if (process.platform === "darwin") {
  cmd = "bash";
  args = [join(scriptsDir, "mac-setup.sh"), ...forward];
} else if (process.platform === "win32") {
  cmd = "powershell";
  args = ["-ExecutionPolicy", "Bypass", "-File", join(scriptsDir, "win-setup.ps1"), ...forward];
} else {
  cmd = "bash";
  args = [join(scriptsDir, "linux-setup.sh"), ...forward];
}

const res = spawnSync(cmd, args, { stdio: "inherit" });
if (res.error) {
  console.error(`[setup] failed to launch ${cmd}: ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status === null ? 1 : res.status);
