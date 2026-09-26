#!/usr/bin/env node
/* Quality-report collector: records Rust tests, clippy, the eslint suppression
   baseline and runtime code-lines into site/reports/<scope>/<ts>.json and rebuilds
   site/reports/runs.json (the dashboard's source). Scopes: local | ci | release.
   Flags: --scope <s>, --harness, --no-cargo. Signals are best-effort — one that
   can't be gathered is recorded null, never a hard failure. */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const SCOPES = ["local", "ci", "release"];
const scope = SCOPES.includes(opt("--scope", "local")) ? opt("--scope", "local") : "local";

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
  } catch (e) {
    // Non-zero exit still yields captured output (e.g. failing tests / clippy).
    return (e.stdout || "") + (e.stderr || "");
  }
}

function cargoVersion() {
  try {
    const toml = readFileSync(join(ROOT, "Cargo.toml"), "utf8");
    const m = toml.match(/^version\s*=\s*"([^"]+)"/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ── Rust unit tests: sum "test result: ok. N passed; M failed" across binaries ──
function collectTests() {
  if (flag("--no-cargo")) return null;
  const out = run("cargo test 2>&1");
  let passed = 0, failed = 0, skipped = 0, seen = false;
  const re = /test result: \w+\. (\d+) passed; (\d+) failed;(?: (\d+) ignored;)?/g;
  let m = re.exec(out);
  while (m) {
    seen = true;
    passed += +m[1];
    failed += +m[2];
    skipped += +(m[3] || 0);
    m = re.exec(out);
  }
  if (!seen) return null;
  return { passed, failed, skipped, total: passed + failed + skipped };
}

// ── Clippy: count warnings under -D warnings (0 when clean) ─────────────────────
function collectClippy() {
  if (flag("--no-cargo")) return null;
  const out = run("cargo clippy --all-targets -- -D warnings 2>&1");
  const warnings = (out.match(/^warning: /gm) || []).length;
  const errors = (out.match(/^error(\[|:)/gm) || []).length;
  return { warnings, errors, clean: warnings === 0 && errors === 0 };
}

// ── Scenario harness: parse PASS/FAIL lines (opt-in; needs a browser) ───────────
function collectHarness() {
  if (!flag("--harness")) return null;
  const out = run("bash scripts/harness.sh 2>&1");
  const passed = (out.match(/PASS/g) || []).length;
  const failed = (out.match(/FAIL/g) || []).length;
  return { passed, failed, total: passed + failed };
}

// ── eslint bulk-suppression baseline: total + per rule ──────────────────────────
function collectSuppressions() {
  const p = join(ROOT, "eslint-suppressions.json");
  if (!existsSync(p)) return null;
  try {
    const s = JSON.parse(readFileSync(p, "utf8"));
    const byRule = {};
    let total = 0;
    for (const file of Object.keys(s)) {
      for (const rule of Object.keys(s[file])) {
        const c = s[file][rule].count || 0;
        total += c;
        byRule[rule] = (byRule[rule] || 0) + c;
      }
    }
    return { total, byRule };
  } catch {
    return null;
  }
}

// ── Injected-runtime code lines (skip blank + comment-only lines) ───────────────
function collectRuntimeCodeLines() {
  const dir = join(ROOT, "runtime");
  let total = 0;
  let counted = false;
  try {
    for (const f of readdirSync(dir)) {
      if (!/^shelves-host.*\.js$/.test(f)) continue;
      counted = true;
      const lines = readFileSync(join(dir, f), "utf8").split("\n");
      for (const ln of lines) {
        const t = ln.trim();
        if (t && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*")) total++;
      }
    }
  } catch {
    return null;
  }
  return counted ? total : null;
}

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

function rebuildAggregate() {
  const reports = join(ROOT, "site", "reports");
  const runs = [];
  for (const sc of SCOPES) {
    const dir = join(reports, sc);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        runs.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
      } catch {
        /* skip a malformed run */
      }
    }
  }
  runs.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  writeFileSync(join(reports, "runs.json"), JSON.stringify(runs, null, 2) + "\n");
  return runs.length;
}

function computeOverall(tests, clippy, harness) {
  const failed =
    (tests && tests.failed > 0) || (clippy && !clippy.clean) || (harness && harness.failed > 0);
  return failed ? "FAIL" : "PASS";
}

function logSummary(record, n) {
  const { tests, clippy, harness, suppressions, runtimeCodeLines } = record;
  const t = tests ? `${tests.passed}/${tests.total}` : "—";
  const c = clippy ? (clippy.clean ? "clean" : `${clippy.warnings}w ${clippy.errors}e`) : "—";
  const hs = harness ? `${harness.passed}/${harness.total}` : "—";
  const s = suppressions ? suppressions.total : "—";
  console.log(`[report] ${record.scope} ${record.ts} → ${record.overall}`);
  console.log(`  tests=${t} clippy=${c} harness=${hs} suppressions=${s} runtimeLines=${runtimeCodeLines ?? "—"}`);
  console.log(`  aggregate: site/reports/runs.json (${n} runs)`);
}

function main() {
  const ts = stamp();
  const tests = collectTests();
  const clippy = collectClippy();
  const harness = collectHarness();
  const record = {
    ts,
    scope,
    version: cargoVersion(),
    overall: computeOverall(tests, clippy, harness),
    tests,
    clippy,
    harness,
    suppressions: collectSuppressions(),
    runtimeCodeLines: collectRuntimeCodeLines(),
  };

  const outDir = join(ROOT, "site", "reports", scope);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${ts}.json`), JSON.stringify(record, null, 2) + "\n");
  logSummary(record, rebuildAggregate());
  return record.overall === "PASS" ? 0 : 1;
}

process.exit(main());
