#!/usr/bin/env node
/* QA-matrix assembler: folds the evidence under site/reports/qa/evidence/ (one
   container record per architecture, one scenario record per harness run) into
   site/reports/qa/matrix.json — a cell per platform × kind with an honest status
   (tested / partial / stale / not-run / blocked / manual; see docs/qa-lab.md). Same
   ts/version/overall fields as the quality runs, so the dashboard can pick it up. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const QA = join(ROOT, "site", "reports", "qa");
const EVIDENCE = join(QA, "evidence");
// An automated cell whose newest evidence is older than this reads `stale` (with ageDays)
// and holds the matrix at PARTIAL: old green files no longer pass it.
const STALE_DAYS = 30;

const CONTAINER_PROVES =
  "host build, install/uninstall lifecycle, RPC, daemon injection into a headless Chromium, runtime scenarios, daemon scenarios, plugin backend probes";

// Cells the lab can clear on its own: their status comes from the evidence files.
// `gate: false` shows without deciding the matrix; `fromEvidence` takes platform and
// architecture from the newest record, since the host harness runs wherever the lab runs.
const AUTOMATED = [
  { id: "linux-x86_64-container", platform: "Linux", arch: "x86_64", kind: "container", files: ["container-x86_64", "scenarios-x86_64", "daemon-scenarios-x86_64"], proves: CONTAINER_PROVES },
  { id: "linux-aarch64-container", platform: "Linux", arch: "aarch64", kind: "container (QEMU)", files: ["container-aarch64", "scenarios-aarch64", "daemon-scenarios-aarch64"], proves: CONTAINER_PROVES },
  { id: "host-harness", platform: process.platform, arch: process.arch, fromEvidence: true, kind: "host harness", files: ["scenarios-host-"], proves: "runtime scenarios (native tab, coexistence, sole host, cooperative, fallback panel, idle cost) in a headless Chromium" },
  { id: "linux-aarch64-steam-container", platform: "Linux", arch: "aarch64", kind: "Steam client container", files: ["steam-container-aarch64"], gate: false, proves: "Valve's native ARM64 Steam client booting headless with its debug port, and — with a signed-in session — the daemon discovering it, injecting the runtime and the bundle, and the backend starting" },
];

// Cells no automation can clear — a lab VM or real hardware. Stated here and in
// docs/qa-lab.md; a human updates both when a lab comes online.
const MANUAL = [
  { id: "steamos-x86_64-device", platform: "SteamOS", arch: "x86_64", kind: "device", status: "manual", files: ["device-steamos-"], note: "Real Steam CEF integration (inject, render, gamepad, coexistence, cooperative) — run on a Steam Deck; `shelveshub status --report` plus the deploy and soak scripts are the evidence." },
  { id: "macos-host-steam", platform: "macOS", arch: "x86_64 / arm64", kind: "device", status: "manual", files: ["device-macos-"], note: "Sole host on this machine's Steam Big Picture (`pnpm local:run`)." },
  { id: "windows-x86_64-vm", platform: "Windows", arch: "x86_64", kind: "vm", status: "blocked", note: "Host, install, logon task, RPC, update and recovery need a Windows VM; CI covers build, unit tests and installer syntax only. Real Steam needs real hardware." },
  { id: "windows-arm64-vm", platform: "Windows", arch: "aarch64", kind: "vm", status: "blocked", note: "No ARM64 Windows lab yet; Steam would run under emulation only." },
  { id: "linux-aarch64-device", platform: "Linux", arch: "aarch64", kind: "device", status: "blocked", note: "Real aarch64 hardware with Steam: install, inject, ARM backend, signed self-update, recovery. Stays experimental until a tester report." },
  { id: "android-arm64-emulator", platform: "Android", arch: "aarch64", kind: "emulator", status: "blocked", note: "Experimental track; not a release criterion." },
];

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/* Evidence stamps are ISO 8601 (UTC) or the older YYYY-MM-DD_HH-MM-SS, read as UTC:
   the containers and the lab write UTC, and a host-local stamp in the old shape is
   hours off at most, which cannot move a 30-day staleness verdict. */
function parseTs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  const ms = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : Date.parse(String(s || ""));
  return Number.isFinite(ms) ? ms : null;
}
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const stamp = (s) => {
  const ms = parseTs(s);
  return ms == null ? (s ?? null) : iso(ms);
};

function evidenceFor(prefixes) {
  if (!existsSync(EVIDENCE)) return [];
  return readdirSync(EVIDENCE)
    .filter((f) => f.endsWith(".json") && prefixes.some((p) => f.startsWith(p)))
    .sort()
    .map((f) => ({ file: `evidence/${f}`, record: readJson(join(EVIDENCE, f)) }))
    .filter((e) => e.record);
}

function recordGreen(r) {
  if (r.overall === "FAIL") return false;
  if (typeof r.failed === "number" && r.failed > 0) return false;
  if (r.steps && Object.values(r.steps).some((s) => s !== "pass")) return false;
  return true;
}

function summarize({ file, record }) {
  const s = { file, ts: stamp(record.ts), kind: record.kind ?? null };
  if (record.steps) s.steps = record.steps;
  if (typeof record.passed === "number") s.scenarios = `${record.passed}/${record.total}`;
  return s;
}

// The newest stamp among the records, its age in days, and whether it is past the cut.
function freshness(ev, now) {
  const stamps = ev.map((e) => parseTs(e.record.ts)).filter((ms) => ms != null);
  if (!stamps.length) return { ts: null, ageDays: null, stale: false };
  const newest = Math.max(...stamps);
  const ageDays = Math.floor((now - newest) / 86400000);
  return { ts: iso(newest), ageDays, stale: ageDays > STALE_DAYS };
}

function newestWithPlatform(ev) {
  return ev.map((e) => e.record).filter((r) => r.os && r.arch).sort((a, b) => (parseTs(a.ts) || 0) - (parseTs(b.ts) || 0)).pop();
}

function automatedCell(c, now) {
  const ev = evidenceFor(c.files);
  const fresh = freshness(ev, now);
  // Every record the cell lists must be there: one that is not leaves it partial, named in `missing`.
  const missing = c.files.filter((p) => !ev.some((e) => e.file.startsWith(`evidence/${p}`)));
  const status = !ev.length ? "not-run" : fresh.stale ? "stale" : !missing.length && ev.every((e) => recordGreen(e.record)) ? "tested" : "partial";
  const from = c.fromEvidence ? newestWithPlatform(ev) : null;
  return {
    id: c.id, platform: from ? from.os : c.platform, arch: from ? from.arch : c.arch, kind: c.kind, proves: c.proves,
    gate: c.gate !== false, status, ...fresh, ...(missing.length ? { missing } : {}), evidence: ev.map(summarize),
  };
}

// A hand-run device record (docs/qa-lab.md template, as JSON) rides along its manual cell as
// evidence; the status stays "manual" — a human ran it, no script judged it — but it ages too.
function manualCell({ files = [], ...c }, now) {
  const ev = evidenceFor(files);
  return { ...c, gate: false, ...freshness(ev, now), evidence: ev.map(summarize) };
}

function cargoVersion() {
  const m = readFileSync(join(ROOT, "Cargo.toml"), "utf8").match(/^version\s*=\s*"([^"]+)"/m);
  return m ? m[1] : null;
}

function overallOf(cells) {
  // An on-demand lab or a manual cell (gate: false) shows its status without deciding the matrix.
  const gating = cells.filter((c) => c.gate);
  if (gating.every((c) => c.status === "not-run")) return "NOT-RUN";
  return gating.some((c) => c.status !== "tested") ? "PARTIAL" : "PASS";
}

function main() {
  const now = Date.now();
  const cells = AUTOMATED.map((c) => automatedCell(c, now)).concat(MANUAL.map((c) => manualCell(c, now)));
  const matrix = { ts: iso(now), version: cargoVersion(), staleDays: STALE_DAYS, overall: overallOf(cells), cells };
  mkdirSync(QA, { recursive: true });
  writeFileSync(join(QA, "matrix.json"), JSON.stringify(matrix, null, 2) + "\n");
  console.log(`[qa-matrix] ${matrix.overall} → site/reports/qa/matrix.json`);
  for (const c of cells) {
    const ev = c.evidence.length ? ` (${c.evidence.map((e) => e.file.replace(/^evidence\//, "")).join(", ")})` : "";
    const age = c.stale ? ` — STALE: ${c.ageDays} days old` : "";
    const miss = c.missing ? ` — MISSING: ${c.missing.join(", ")}` : "";
    console.log(`  ${c.status.padEnd(8)} ${c.platform} ${c.arch} · ${c.kind}${ev}${age}${miss}`);
  }
  return matrix.overall === "PARTIAL" ? 1 : 0;
}

process.exit(main());
