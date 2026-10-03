#!/usr/bin/env node
/* Run the ShelvesHub daemon against the REAL local Steam Big Picture (sole host) on macOS/Windows/
   Linux. The plugin need not be checked out (the daemon downloads the latest Deck Shelves release);
   a sibling checkout or SHELVES_BUNDLE_PATH overrides it. Needs Steam with CEF remote debugging +
   Big Picture open; settings/env in `.env`. Flags: --reseed (refresh bundle), --reload, --prerelease,
   --no-build. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, statSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const isWin = platform() === "win32";
const MIN_BYTES = 4096; // matches populate.rs REAL_BUNDLE_MIN_BYTES

// ── Stop-only: kill the running daemon and exit ─────────────────────────────
function stopDaemon() {
  if (isWin) spawnSync("taskkill", ["/IM", "shelveshub.exe", "/F"], { stdio: "ignore" });
  else spawnSync("pkill", ["-x", "shelveshub"], { stdio: "ignore" });
}
if (has("--stop")) { stopDaemon(); console.log("[OK] daemon stopped (if it was running)."); process.exit(0); }

// ── Per-OS data dir for the managed dev bundle + daemon log ─────────────────
function dataDir() {
  if (isWin) return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "shelveshub-dev");
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "shelveshub-dev");
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "shelveshub-dev");
}
const DATA = dataDir();
mkdirSync(DATA, { recursive: true });
const MANAGED = join(DATA, "bundle.js");
const LOG = join(DATA, "daemon.log");

// ── Resolve the plugin bundle to seed from ──────────────────────────────────
const devBundle = process.env.SHELVES_BUNDLE_PATH
  || resolve(ROOT, "..", "Deck-Shelves", "dist", "index.iife.js");

// Resolve the bundle the daemon should inject. Returns true if a local build was
// seeded; false if we leave the managed path for the daemon to populate from the
// latest GitHub (pre)release (no plugin checkout required).
function seedBundle() {
  const sz = existsSync(MANAGED) ? statSync(MANAGED).size : 0;
  if (!has("--reseed") && sz >= MIN_BYTES) {
    console.log(`[i] Kept managed bundle (${sz} bytes) — survives restarts (self-installed or previously fetched).`);
    return true;
  }
  const hasLocal = existsSync(devBundle) && statSync(devBundle).size >= MIN_BYTES;
  if (hasLocal) {
    copyFileSync(devBundle, MANAGED);
    console.log(`[i] Seeded managed bundle from local plugin build ${devBundle} (${statSync(MANAGED).size} bytes).`);
    return true;
  }
  // No local build — the daemon will download the newest Deck Shelves
  // (pre)release into the managed path on boot (ensure_bundle). No clone needed.
  console.log(`[i] No local plugin build at ${devBundle} — the daemon will download the latest ${has("--prerelease") ? "pre-release" : "release"} from GitHub.`);
  return false;
}

// ── Build the daemon ────────────────────────────────────────────────────────
if (!has("--no-build")) {
  console.log("[i] Building daemon (cargo build)...");
  const b = spawnSync("cargo", ["build"], { cwd: ROOT, stdio: "inherit" });
  if (b.status !== 0) { console.error("[!] cargo build failed."); process.exit(b.status ?? 1); }
}
const bin = join(ROOT, "target", "debug", isWin ? "shelveshub.exe" : "shelveshub");
if (!existsSync(bin)) { console.error(`[!] Daemon binary not found at ${bin} — run without --no-build.`); process.exit(1); }

seedBundle();

// Seed the daemon's config file (<exe_dir>/shelveshub.config.json) with sole-host dev defaults
// (force_owner / native_qam) in the FILE not env, so the advanced-config editor can change them and
// the change PERSISTS across restarts. Only missing keys are added — an existing value is kept.
const CONFIG_FILE = join(ROOT, "target", "debug", "shelveshub.config.json");
function seedConfig() {
  const defaults = { force_owner: true, native_qam: true, owner_settle_secs: 0 };
  let obj = {};
  try { obj = JSON.parse(readFileSync(CONFIG_FILE, "utf8")); } catch { obj = {}; }
  let changed = !existsSync(CONFIG_FILE);
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in obj)) { obj[k] = v; changed = true; }
  }
  if (!changed) { console.log(`[i] Kept existing dev config ${CONFIG_FILE} (edits preserved).`); return; }
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(obj, null, 2) + "\n");
    console.log(`[i] Seeded dev config defaults into ${CONFIG_FILE} (missing keys only — edits persist).`);
  } catch (e) { console.warn(`[!] Could not seed dev config (${e}); the daemon falls back to defaults.`); }
}
seedConfig();

// ── Stop any previous instance ──────────────────────────────────────────────
stopDaemon();

// ── Launch the daemon against the local Steam CEF ───────────────────────────
const env = {
  ...process.env,
  SHELVES_CEF_HOST: process.env.SHELVES_CEF_HOST || "127.0.0.1",
  SHELVES_CEF_PORT: process.env.SHELVES_CEF_PORT || "8080",
  SHELVES_HOST_RUNTIME_PATH: process.env.SHELVES_HOST_RUNTIME_PATH || join(ROOT, "runtime", "shelves-host.js"),
  SHELVES_BUNDLE_PATH: MANAGED,
  /* force_owner / native_qam / owner_settle come from the seeded config FILE
     (see seedConfig) so the hub's config editor can change them persistently —
     env vars would override the file every boot. A caller can still force any
     of them by exporting the env var before running this script. */
  ...(process.env.SHELVES_FORCE_OWNER ? { SHELVES_FORCE_OWNER: process.env.SHELVES_FORCE_OWNER } : {}),
  ...(process.env.SHELVES_NATIVE_QAM ? { SHELVES_NATIVE_QAM: process.env.SHELVES_NATIVE_QAM } : {}),
  ...(process.env.SHELVES_OWNER_SETTLE_SECS ? { SHELVES_OWNER_SETTLE_SECS: process.env.SHELVES_OWNER_SETTLE_SECS } : {}),
  ...(has("--prerelease") ? { SHELVES_PRERELEASE: "1" } : {}),
};
const logFd = openSync(LOG, "a");
const child = spawn(bin, [], { cwd: ROOT, env, detached: true, stdio: ["ignore", logFd, logFd] });
child.unref();
console.log(`[OK] daemon started (PID ${child.pid}) → CEF ${env.SHELVES_CEF_HOST}:${env.SHELVES_CEF_PORT}. Log: ${LOG}`);

// ── Optionally reload the renderer so the fresh bundle re-injects ────────────
if (has("--reload")) {
  console.log("[i] Reloading the renderer via shelves-devtools...");
  const dt = spawnSync("node", [join(ROOT, "scripts", "local-devtools.mjs"), "reload"], { cwd: ROOT, env, stdio: "inherit" });
  if (dt.status !== 0) console.warn("[!] reload failed — reload Big Picture manually if the fresh bundle isn't live.");
}
