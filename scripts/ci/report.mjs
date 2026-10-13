#!/usr/bin/env node
/* Quality reports: the signal collectors (Rust tests, clippy, rustfmt, cargo audit,
   ESLint, complexity debt, the runtime harness, code lines, the QA matrix, docs and
   localization), the per-run record + HTML page, the per-scope indexes and the
   aggregate site/reports/runs.json the dashboard reads. `pnpm report` runs the
   collectors alone; scripts/validate.mjs runs them as recorded steps. */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SCOPES = ["local", "ci", "release"];
const REPORTS = join(ROOT, "site", "reports");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

export function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...opts });
  } catch (e) {
    // Non-zero exit still yields captured output (e.g. failing tests / clippy).
    return (e.stdout || "") + (e.stderr || "");
  }
}

export function cargoVersion() {
  try {
    const m = readFileSync(join(ROOT, "Cargo.toml"), "utf8").match(/^version\s*=\s*"([^"]+)"/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ── The gate commands and the parsers of their output (pure) ────────────────────
export const CMD = {
  tests: "cargo test 2>&1",
  clippy: "cargo clippy --all-targets -- -D warnings 2>&1",
  fmt: "cargo fmt --check 2>&1",
  audit: "cargo audit --json 2>/dev/null",
  harness: "bash scripts/harness.sh 2>&1",
  eslint: "npx eslint --no-warn-ignored --pass-on-unpruned-suppressions --format json .",
  complexity: `npx eslint --no-config-lookup -c "${join(ROOT, "scripts", "ci", "complexity.eslint.config.mjs")}" --no-warn-ignored --format json runtime`,
};

export function parseTests(out) {
  let passed = 0, failed = 0, skipped = 0, seen = false;
  const re = /test result: \w+\. (\d+) passed; (\d+) failed;(?: (\d+) ignored;)?/g;
  for (let m = re.exec(out); m; m = re.exec(out)) {
    seen = true;
    passed += +m[1];
    failed += +m[2];
    skipped += +(m[3] || 0);
  }
  return seen ? { passed, failed, skipped, total: passed + failed + skipped } : null;
}

export function parseClippy(out) {
  const warnings = (out.match(/^warning: /gm) || []).length;
  const errors = (out.match(/^error(\[|:)/gm) || []).length;
  return { warnings, errors, clean: warnings === 0 && errors === 0 };
}

export function parseFmt(out) {
  return { clean: !/^Diff in /m.test(out) };
}

export function auditAvailable() {
  return /cargo-audit/.test(run("cargo audit --version 2>&1"));
}

export function parseAudit(out) {
  try {
    const j = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    const vulnerabilities = (j.vulnerabilities && j.vulnerabilities.count) || 0;
    return { vulnerabilities, clean: vulnerabilities === 0 };
  } catch {
    return null;
  }
}

export function parseHarness(out) {
  const passed = (out.match(/PASS/g) || []).length;
  const failed = (out.match(/FAIL/g) || []).length;
  return passed + failed ? { passed, failed, total: passed + failed } : null;
}

// The JSON array an eslint run printed (stderr may follow it when the exit was non-zero).
function eslintJson(out) {
  try {
    return JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1));
  } catch {
    return null;
  }
}

export function parseEslint(out) {
  const files = eslintJson(out);
  if (!files) return null;
  let errors = 0, warnings = 0;
  const byRule = {};
  for (const f of files) {
    errors += f.errorCount || 0;
    warnings += f.warningCount || 0;
    for (const m of f.messages || []) {
      const k = m.ruleId || "(parse)";
      byRule[k] = (byRule[k] || 0) + 1;
    }
  }
  return { errors, warnings, problems: errors + warnings, byRule };
}

function complexityRow(file, m) {
  const score = m.ruleId === "complexity" ? /complexity of (\d+)/.exec(m.message || "") : null;
  if (!score) return null;
  const fn = /(?:Function|Arrow function|Method)\s+'?([^']*)'?\s+has/.exec(m.message || "");
  return { file, line: m.line, fn: (fn && fn[1]) || "(anonymous)", score: +score[1] };
}

/* Cyclomatic-complexity debt of the shipped runtime: the sum of the scores of
   every function over the limit (level), how many there are (count) and the worst
   one (max) — the trend rises when code gets structurally deeper even while the
   number of offenders stays flat. */
export function parseComplexity(out) {
  const files = eslintJson(out);
  if (!files) return null;
  const rows = [];
  for (const f of files) {
    for (const m of f.messages || []) {
      const row = complexityRow(relative(ROOT, f.filePath), m);
      if (row) rows.push(row);
    }
  }
  rows.sort((a, b) => b.score - a.score);
  const level = rows.reduce((s, r) => s + r.score, 0);
  return { level, count: rows.length, max: rows.length ? rows[0].score : 0, top: rows.slice(0, 8) };
}

// Human summaries of the parsed signals, for a step's log.
export function describe(kind, v) {
  if (!v) return "not measured";
  if (kind === "eslint") return `${v.errors} errors, ${v.warnings} warnings` + (v.problems ? ` — ${Object.entries(v.byRule).map(([r, n]) => `${r}: ${n}`).join(", ")}` : "");
  if (kind === "complexity") return v.count ? `debt ${v.level} across ${v.count} function(s), worst ${v.max}: ${v.top.map((t) => `${t.fn} (${t.score}) ${t.file}:${t.line}`).join("; ")}` : "every runtime function is within the limit";
  if (kind === "tests") return `${v.passed}/${v.total} passed`;
  if (kind === "harness") return `${v.passed}/${v.total} scenarios`;
  if (kind === "audit") return `${v.vulnerabilities} advisories`;
  return v.clean ? "clean" : "not clean";
}

// ── Cheap collectors (no commands) ───────────────────────────────────────────────
export function collectSuppressions() {
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

function codeLines(path) {
  let n = 0;
  for (const ln of readFileSync(path, "utf8").split("\n")) {
    const t = ln.trim();
    if (t && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*")) n++;
  }
  return n;
}

export function collectRuntimeCodeLines() {
  const dir = join(ROOT, "runtime");
  let total = 0, counted = false;
  try {
    for (const f of readdirSync(dir)) {
      if (!/^shelves-host.*\.js$/.test(f)) continue;
      counted = true;
      total += codeLines(join(dir, f));
    }
  } catch {
    return null;
  }
  return counted ? total : null;
}

export function collectRustCodeLines() {
  let total = 0, files = 0;
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith(".rs")) { files++; total += codeLines(p); }
    }
  };
  try {
    walk(join(ROOT, "src"));
  } catch {
    return null;
  }
  return files ? { total, files } : null;
}

export function collectQa() {
  const p = join(REPORTS, "qa", "matrix.json");
  if (!existsSync(p)) return null;
  try {
    const m = JSON.parse(readFileSync(p, "utf8"));
    const byStatus = {};
    for (const c of m.cells || []) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    return { cells: (m.cells || []).length, byStatus, assembled: m.ts || null };
  } catch {
    return null;
  }
}

// Parity is by key NAME against en-US, not by count: a renamed key is a miss plus an extra.
function localeParity(file, en) {
  const keys = new Set(Object.keys(JSON.parse(readFileSync(file, "utf8"))));
  const missing = en.filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !en.includes(k));
  const parts = [];
  if (missing.length) parts.push(`missing ${missing.join(", ")}`);
  if (extra.length) parts.push(`extra ${extra.join(", ")}`);
  return parts.join("; ");
}

export function collectDocs() {
  const out = { locales: 0, keys: 0, keyParity: true, parityProblems: [], docPairs: 0, docsUnpaired: 0 };
  try {
    const dir = join(ROOT, "runtime", "i18n");
    const en = Object.keys(JSON.parse(readFileSync(join(dir, "en-US.json"), "utf8")));
    out.keys = en.length;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      out.locales++;
      const problem = localeParity(join(dir, f), en);
      if (problem) out.parityProblems.push(`${f}: ${problem}`);
    }
    out.keyParity = out.parityProblems.length === 0;
  } catch {
    out.locales = 0;
  }
  try {
    const en = readdirSync(join(ROOT, "docs")).filter((f) => f.endsWith(".md"));
    const pt = new Set(readdirSync(join(ROOT, "docs", "pt-BR")));
    out.docPairs = en.filter((f) => pt.has(f)).length;
    out.docsUnpaired = en.length - out.docPairs;
  } catch {
    out.docPairs = 0;
  }
  return out;
}

export function cheapSignals() {
  return { suppressions: collectSuppressions(), runtimeCodeLines: collectRuntimeCodeLines(), rustCodeLines: collectRustCodeLines(), qa: collectQa(), docs: collectDocs() };
}

// ── Gates and the overall verdict ────────────────────────────────────────────────
export function gateResults(r) {
  return {
    tests: r.tests ? r.tests.failed === 0 : null,
    clippy: r.clippy ? r.clippy.clean : null,
    fmt: r.fmt ? r.fmt.clean : null,
    eslint: r.eslint ? r.eslint.errors === 0 : null,
    harness: r.harness ? r.harness.failed === 0 : null,
    audit: r.audit ? r.audit.clean : null,
  };
}

export function computeOverall(record) {
  const gates = Object.values(gateResults(record));
  const stepFailed = (record.steps || []).some((s) => s.status === "fail");
  return gates.some((g) => g === false) || stepFailed ? "FAIL" : "PASS";
}

// ── Records, pages and indexes ───────────────────────────────────────────────────
export function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtMs(ms) {
  if (ms == null) return "—";
  return ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

const PAGE_CSS = `
  .rep-wrap { max-width: var(--maxw); margin: 0 auto; padding: 32px 20px 64px; }
  .rep-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .rep-head h1 { margin: 0; font-size: 22px; }
  .muted { color: var(--fg-dim); font-size: 13px; }
  a.back { color: var(--accent); text-decoration: none; font-size: 13px; }
  .pill { font-size: 12px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border); color: var(--fg-dim); }
  .pill.pass { color: #15a34a; border-color: rgba(21,163,74,.4); } .pill.fail { color: #dc2626; border-color: rgba(220,38,38,.4); } .pill.skip { color: #d97706; border-color: rgba(217,119,6,.4); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 18px 0; }
  .card { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--card-shadow); padding: 14px 16px; }
  .card .k { color: var(--fg-dim); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; } .card .v { font-size: 26px; font-weight: 700; margin-top: 4px; }
  .v.pass { color: #15a34a; } .v.fail { color: #dc2626; } .v.skip { color: #d97706; }
  h2 { font-size: 15px; margin: 26px 0 10px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 14px; } .row:last-child { border-bottom: 0; } .row .lbl { flex: 1; min-width: 0; } .row .sub { color: var(--fg-dim); font-size: 12px; }
  details { border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-elev); margin: 8px 0; }
  details summary { cursor: pointer; padding: 10px 14px; display: flex; align-items: center; gap: 10px; font-size: 14px; list-style: none; } details summary::-webkit-details-marker { display: none; }
  details summary .lbl { flex: 1; } details summary .dur { color: var(--fg-dim); font-size: 12px; font-variant-numeric: tabular-nums; }
  pre.log { margin: 0; padding: 12px 14px; border-top: 1px solid var(--border); font-size: 12px; line-height: 1.45; overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 480px; overflow-y: auto; }
  table.mini { width: 100%; border-collapse: collapse; font-size: 13px; } table.mini th, table.mini td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); } table.mini th { color: var(--fg-dim); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; } table.mini td.num { text-align: right; font-variant-numeric: tabular-nums; }
`;

function pageShell(title, body, depth) {
  const up = "../".repeat(depth);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="robots" content="noindex">
  <link rel="icon" type="image/svg+xml" href="${up}favicon.svg">
  <link rel="stylesheet" href="${up}style.css">
  <style>${PAGE_CSS}</style>
</head>
<body>
  <div class="rep-wrap">
${body}
  </div>
</body>
</html>
`;
}

function signalRows(r) {
  const rows = [
    ["Rust unit tests", describe("tests", r.tests)],
    ["clippy", describe("clippy", r.clippy)],
    ["rustfmt", describe("fmt", r.fmt)],
    ["ESLint", describe("eslint", r.eslint)],
    ["Runtime harness", describe("harness", r.harness)],
    ["cargo audit", describe("audit", r.audit)],
    ["Complexity debt (runtime)", describe("complexity", r.complexity)],
    ["Lint suppressions", r.suppressions ? String(r.suppressions.total) : "not measured"],
    ["Code lines", `runtime ${r.runtimeCodeLines ?? "—"} · Rust ${r.rustCodeLines ? r.rustCodeLines.total : "—"}`],
    ["QA matrix", r.qa ? Object.entries(r.qa.byStatus).map(([k, n]) => `${k} ${n}`).join(" · ") : "not assembled"],
    ["Localization / docs", r.docs ? `${r.docs.locales} locales · ${r.docs.keys} keys${r.docs.keyParity ? "" : " (parity broken)"} · ${r.docs.docPairs} doc pairs` : "not measured"],
  ];
  return rows.map(([k, v]) => `<div class="row"><span class="lbl">${esc(k)}</span><span class="sub">${esc(v)}</span></div>`).join("\n");
}

function stepDetails(s) {
  return `<details${s.status === "fail" ? " open" : ""}>
  <summary><span class="pill ${esc(s.status)}">${esc(s.status.toUpperCase())}</span><span class="lbl">${esc(s.label)}</span><span class="dur">${esc(fmtMs(s.durationMs))}</span></summary>
  <pre class="log">${esc(s.log || "(no output)")}</pre>
</details>`;
}

// The per-run page: verdict, step counts, the parsed signals, every step with its log tail.
export function renderRunPage(r) {
  const c = r.stepsSummary || { passed: 0, failed: 0, skipped: 0, total: 0 };
  const cls = r.overall === "PASS" ? "pass" : "fail";
  const body = `    <div class="rep-head">
      <a class="back" href="index.html">← ${esc(r.scope)} runs</a>
      <h1>ShelvesHub · ${esc(r.scope)} run</h1>
      <span class="pill ${cls}">${esc(r.overall)}</span>
      <span class="muted">${esc(String(r.ts).replace("_", " "))}${r.version ? " · v" + esc(r.version) : ""}</span>
      <span class="muted"><a class="back" href="../dashboard.html">Dashboard →</a></span>
    </div>
    <div class="grid">
      <div class="card"><div class="k">Passed</div><div class="v pass">${c.passed}</div></div>
      <div class="card"><div class="k">Failed</div><div class="v fail">${c.failed}</div></div>
      <div class="card"><div class="k">Skipped</div><div class="v skip">${c.skipped}</div></div>
      <div class="card"><div class="k">Steps</div><div class="v">${c.total}</div></div>
      <div class="card"><div class="k">Duration</div><div class="v">${esc(fmtMs(r.durations && r.durations.total))}</div></div>
    </div>
    <h2>Signals</h2>
    <div class="card">
${signalRows(r)}
    </div>
    <h2>Steps</h2>
${(r.steps || []).map(stepDetails).join("\n")}`;
  return pageShell(`ShelvesHub — ${r.scope} ${r.ts}`, body, 2);
}

// One scope's history page: every run, newest first.
export function renderScopeIndex(scope, runs) {
  const rows = runs.slice().reverse().map((r) => {
    const c = r.stepsSummary;
    return `<tr><td>${r.page ? `<a class="back" href="${esc(r.ts)}.html">${esc(String(r.ts).replace("_", " "))}</a>` : esc(String(r.ts).replace("_", " "))}</td>` +
      `<td>${r.version ? "v" + esc(r.version) : "—"}</td><td><span class="pill ${r.overall === "PASS" ? "pass" : "fail"}">${esc(r.overall)}</span></td>` +
      `<td class="num">${c ? `${c.passed}/${c.total}` : "—"}</td><td class="num">${r.tests ? `${r.tests.passed}/${r.tests.total}` : "—"}</td>` +
      `<td class="num">${r.harness ? `${r.harness.passed}/${r.harness.total}` : "—"}</td><td class="num">${esc(fmtMs(r.durations && r.durations.total))}</td></tr>`;
  }).join("\n");
  const body = `    <div class="rep-head">
      <a class="back" href="../index.html">← All reports</a>
      <h1>ShelvesHub · ${esc(scope)} runs</h1>
      <span class="muted">${runs.length} recorded · <a class="back" href="../dashboard.html">Dashboard →</a></span>
    </div>
    <div class="card" style="margin-top:18px">
      <table class="mini"><tr><th>Run</th><th>Version</th><th>Verdict</th><th class="num">Steps</th><th class="num">Rust tests</th><th class="num">Scenarios</th><th class="num">Duration</th></tr>
${rows || '<tr><td colspan="7" class="muted">No runs recorded yet.</td></tr>'}
      </table>
    </div>`;
  return pageShell(`ShelvesHub — ${scope} runs`, body, 2);
}

function readRuns(scope) {
  const dir = join(REPORTS, scope);
  if (!existsSync(dir)) return [];
  const runs = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      runs.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
    } catch {
      /* skip a malformed run */
    }
  }
  return runs.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

// Strip step logs from the aggregate (they live in the per-run file and page).
function slim(record) {
  const out = { ...record };
  if (out.steps) out.steps = out.steps.map(({ key, label, status, durationMs }) => ({ key, label, status, durationMs }));
  return out;
}

/* Rebuild everything derived: each scope's index page, a page for every run that
   has steps but no page yet (a run carried onto another branch), and runs.json. */
export function rebuildAggregate() {
  const all = [];
  for (const scope of SCOPES) {
    const runs = readRuns(scope);
    if (!runs.length && !existsSync(join(REPORTS, scope))) continue;
    for (const r of runs) {
      if (r.steps && !existsSync(join(REPORTS, scope, `${r.ts}.html`))) {
        writeFileSync(join(REPORTS, scope, `${r.ts}.html`), renderRunPage(r));
        r.page = `${scope}/${r.ts}.html`;
      }
    }
    mkdirSync(join(REPORTS, scope), { recursive: true });
    writeFileSync(join(REPORTS, scope, "index.html"), renderScopeIndex(scope, runs));
    all.push(...runs.map(slim));
  }
  all.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  writeFileSync(join(REPORTS, "runs.json"), JSON.stringify(all, null, 2) + "\n");
  return all.length;
}

// Write a run (signals + optional steps) and refresh the derived files.
export function recordRun({ scope, ts, signals, steps, durations }) {
  const record = { ts, scope, version: cargoVersion(), overall: "PASS", ...signals, durations };
  if (steps) {
    record.steps = steps;
    const n = (s) => steps.filter((x) => x.status === s).length;
    record.stepsSummary = { passed: n("pass"), failed: n("fail"), skipped: n("skip"), total: steps.length };
    record.page = `${scope}/${ts}.html`;
  }
  record.overall = computeOverall(record);
  const outDir = join(REPORTS, scope);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${ts}.json`), JSON.stringify(record, null, 2) + "\n");
  if (steps) writeFileSync(join(outDir, `${ts}.html`), renderRunPage(record));
  return { record, runs: rebuildAggregate() };
}

export function logSummary(record, n) {
  const cx = record.complexity;
  const parts = [
    `tests=${describe("tests", record.tests)}`,
    `clippy=${describe("clippy", record.clippy)}`,
    `fmt=${describe("fmt", record.fmt)}`,
    `harness=${describe("harness", record.harness)}`,
    `eslint=${record.eslint ? `${record.eslint.errors}e ${record.eslint.warnings}w` : "not measured"}`,
    `complexity=${cx ? `${cx.level} (${cx.count} over, max ${cx.max})` : "not measured"}`,
    `suppressions=${record.suppressions ? record.suppressions.total : "—"}`,
    `runtimeLines=${record.runtimeCodeLines ?? "—"}`,
    `rustLines=${record.rustCodeLines ? record.rustCodeLines.total : "—"}`,
    `total=${record.durations ? record.durations.total : "—"}ms`,
  ];
  console.log(`[report] ${record.scope} ${record.ts} → ${record.overall}`);
  console.log(`  ${parts.join(" · ")}`);
  console.log(`  aggregate: site/reports/runs.json (${n} runs)${record.page ? ` · page: site/reports/${record.page}` : ""}`);
}

// Run a collector command and time it (ms), for the step-duration trends.
function timed(durations, name, fn) {
  const t0 = Date.now();
  const value = fn();
  durations[name] = Date.now() - t0;
  return value;
}

// `pnpm report`: the collectors alone (no step logs); scripts/validate.mjs records steps too.
function main() {
  if (flag("--aggregate-only")) {
    const n = rebuildAggregate();
    console.log(`[report] aggregate-only → site/reports/runs.json (${n} runs)`);
    return 0;
  }
  const scope = SCOPES.includes(opt("--scope", "local")) ? opt("--scope", "local") : "local";
  const noCargo = flag("--no-cargo");
  const durations = {};
  const t0 = Date.now();
  const signals = {
    tests: noCargo ? null : timed(durations, "tests", () => parseTests(run(CMD.tests))),
    clippy: noCargo ? null : timed(durations, "clippy", () => parseClippy(run(CMD.clippy))),
    fmt: noCargo ? null : timed(durations, "fmt", () => parseFmt(run(CMD.fmt))),
    audit: noCargo || !auditAvailable() ? null : timed(durations, "audit", () => parseAudit(run(CMD.audit))),
    harness: flag("--harness") ? timed(durations, "harness", () => parseHarness(run(CMD.harness))) : null,
    eslint: timed(durations, "eslint", () => parseEslint(run(CMD.eslint))),
    complexity: timed(durations, "complexity", () => parseComplexity(run(CMD.complexity))),
    ...cheapSignals(),
  };
  durations.total = Date.now() - t0;
  const { record, runs } = recordRun({ scope, ts: stamp(), signals, durations });
  logSummary(record, runs);
  return record.overall === "PASS" ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
