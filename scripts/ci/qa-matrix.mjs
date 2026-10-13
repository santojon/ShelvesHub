#!/usr/bin/env node
/* QA-matrix assembler: folds the evidence under site/reports/qa/evidence/ (one
   container record per architecture, one scenario record per harness run) into
   site/reports/qa/matrix.json — a cell per platform × kind with an honest status
   (tested / partial / not-run / blocked / manual; see docs/qa-lab.md). Same
   ts/version/overall fields as the quality runs, so the dashboard can pick it up. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const QA = join(ROOT, "site", "reports", "qa");
const EVIDENCE = join(QA, "evidence");

const CONTAINER_PROVES =
  "host build, install/uninstall lifecycle, RPC, daemon injection into a headless Chromium, runtime scenarios, plugin backend probes";

// Cells the lab can clear on its own: their status comes from the evidence files.
const AUTOMATED = [
  { id: "linux-x86_64-container", platform: "Linux", arch: "x86_64", kind: "container", files: ["container-x86_64", "scenarios-x86_64"], proves: CONTAINER_PROVES },
  { id: "linux-aarch64-container", platform: "Linux", arch: "aarch64", kind: "container (QEMU)", files: ["container-aarch64", "scenarios-aarch64"], proves: CONTAINER_PROVES },
  { id: "host-harness", platform: process.platform, arch: process.arch, kind: "host harness", files: ["scenarios-host-"], proves: "runtime scenarios (native tab, coexistence, sole host, cooperative, fallback panel, idle cost) in a headless Chromium" },
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
  const s = { file, ts: record.ts ?? null, kind: record.kind ?? null };
  if (record.steps) s.steps = record.steps;
  if (typeof record.passed === "number") s.scenarios = `${record.passed}/${record.total}`;
  return s;
}

function automatedCell(c) {
  const ev = evidenceFor(c.files);
  const status = !ev.length ? "not-run" : ev.every((e) => recordGreen(e.record)) ? "tested" : "partial";
  const ts = ev.map((e) => String(e.record.ts || "")).sort().pop() || null;
  return { id: c.id, platform: c.platform, arch: c.arch, kind: c.kind, proves: c.proves, status, ts, evidence: ev.map(summarize) };
}

function cargoVersion() {
  const m = readFileSync(join(ROOT, "Cargo.toml"), "utf8").match(/^version\s*=\s*"([^"]+)"/m);
  return m ? m[1] : null;
}

function overallOf(cells) {
  // An on-demand lab (gate: false) shows its status without deciding the matrix.
  const auto = cells.filter((c) => AUTOMATED.some((a) => a.id === c.id && a.gate !== false));
  if (auto.every((c) => c.status === "not-run")) return "NOT-RUN";
  return auto.some((c) => c.status === "partial") ? "PARTIAL" : "PASS";
}

function main() {
  // A hand-run device record (docs/qa-lab.md template, as JSON) rides along its manual
  // cell as evidence; the status stays "manual" — a human ran it, no script judged it.
  const manualCell = ({ files = [], ...c }) => ({ ...c, evidence: evidenceFor(files).map(summarize) });
  const cells = AUTOMATED.map(automatedCell).concat(MANUAL.map(manualCell));
  const p = (n) => String(n).padStart(2, "0");
  const d = new Date();
  const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  const matrix = { ts, version: cargoVersion(), overall: overallOf(cells), cells };
  mkdirSync(QA, { recursive: true });
  writeFileSync(join(QA, "matrix.json"), JSON.stringify(matrix, null, 2) + "\n");
  console.log(`[qa-matrix] ${matrix.overall} → site/reports/qa/matrix.json`);
  for (const c of cells) {
    const ev = c.evidence.length ? ` (${c.evidence.map((e) => e.file.replace(/^evidence\//, "")).join(", ")})` : "";
    console.log(`  ${c.status.padEnd(8)} ${c.platform} ${c.arch} · ${c.kind}${ev}`);
  }
  return matrix.overall === "PARTIAL" ? 1 : 0;
}

process.exit(main());
