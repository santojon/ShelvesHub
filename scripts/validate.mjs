#!/usr/bin/env node
/* Full validation, every CI gate as a recorded step (rustfmt, clippy, Rust tests,
   cargo audit, ESLint, complexity debt, JS syntax, data files + localization, the
   launchers, the shipped-text rule, the runtime harness; container harness and QA
   matrix on request), written as site/reports/<scope>/<ts>.json + .html. Usage:
   pnpm validate [--docker] [--qa] [--no-cargo] [--scope s] · pnpm validate:ci */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Harness, runCommand, timestamp } from "./ci/lib/harness.mjs";
import {
  CMD, ROOT, SCOPES, auditAvailable, cheapSignals, collectDocs, logSummary, parseAudit, parseClippy,
  parseComplexity, parseEslint, parseFmt, parseHarness, parseTests, describe, recordRun, run,
} from "./ci/report.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

function scopeFromEnv() {
  if (process.env.REPORT_SCOPE && SCOPES.includes(process.env.REPORT_SCOPE)) return process.env.REPORT_SCOPE;
  return (process.env.GITHUB_REF || "").startsWith("refs/tags/v") ? "release" : "ci";
}
const scope = flag("--ci") ? scopeFromEnv() : (SCOPES.includes(opt("--scope", "local")) ? opt("--scope", "local") : "local");
const noCargo = flag("--no-cargo");
const h = new Harness(ROOT);
const signals = {};

// ── Function steps (checks the CI runs inline) ────────────────────────────────
function walk(dir, keep, out = []) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name !== "node_modules" && f.name !== "target" && f.name !== "vendor") walk(p, keep, out);
    } else if (keep(p)) out.push(p);
  }
  return out;
}

function jsSyntax() {
  const files = ["runtime", "scripts", "examples"].flatMap((d) => walk(join(ROOT, d), (p) => /\.(js|mjs)$/.test(p)));
  const bad = [];
  for (const f of files) {
    const { ok, output } = runCommand(`node --check "${f}"`, { cwd: ROOT });
    if (!ok) bad.push(`${relative(ROOT, f)}: ${output.trim().split("\n")[0]}`);
  }
  return { ok: bad.length === 0, output: bad.length ? bad.join("\n") : `${files.length} files parse` };
}

function dataFiles() {
  const problems = [];
  const files = [...walk(join(ROOT, "runtime", "i18n"), (p) => p.endsWith(".json")), join(ROOT, "shelveshub.config.json"), join(ROOT, "site", "analytics.json")];
  for (const f of files) {
    try {
      JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      problems.push(`${relative(ROOT, f)}: ${e.message}`);
    }
  }
  const docs = collectDocs();
  if (!docs.keyParity) problems.push("i18n key parity: a locale differs from en-US");
  if (docs.docsUnpaired) problems.push(`${docs.docsUnpaired} doc(s) without a pt-BR pair`);
  const output = problems.length ? problems.join("\n") : `${files.length} JSON files valid · ${docs.locales} locales × ${docs.keys} keys in parity · ${docs.docPairs} doc pairs`;
  return { ok: problems.length === 0, output };
}

// A launcher's Exec line must hand off to bash with nothing the entry launcher expands.
function launchers() {
  const files = walk(join(ROOT, "installer"), (p) => p.endsWith(".desktop"));
  const problems = [];
  for (const f of files) {
    const exec = (readFileSync(f, "utf8").match(/^Exec=(.*)$/m) || [])[1] || "";
    const rel = relative(ROOT, f);
    if (!exec) { problems.push(`${rel}: no Exec line`); continue; }
    if (/[$`%]/.test(exec)) problems.push(`${rel}: Exec contains $, a backtick or %`);
    const m = /^bash -c "(.*)"$/.exec(exec);
    if (!m) { problems.push(`${rel}: Exec is not bash -c "…"`); continue; }
    const { ok, output } = runCommand(`bash -n -c ${JSON.stringify(m[1])}`, { cwd: ROOT });
    if (!ok) problems.push(`${rel}: ${output.trim()}`);
  }
  return { ok: problems.length === 0, output: problems.length ? problems.join("\n") : `${files.length} launchers parse` };
}

/* The shipped-text rule (see the repository's docs-language rule): process words,
   tool names and the loader's name must not appear in committed text. The pattern
   and the interop allowlist are assembled from pieces so this file never matches
   its own check. */
function shippedText() {
  const words = ["spr" + "int", "\\broa" + "dmap\\b", "\\bba" + "tch\\b", "\\bA\\.?I\\b", "de" + "cky", "\\bcla" + "ude\\b", "\\.cla" + "ude", "\\.roa" + "dmaps"];
  const re = new RegExp(words.join("|"), "i");
  const allow = ["borrowedToaster", "De" + "ckyPluginLoader", "de" + "ckyHasLoaded", "de" + "ckyLoaderAPIInit", "de" + "ckyFrontendLib", "__DECK_SHELVES_OWNER__ = \"de" + "cky\"", "owner===\"de" + "cky\""];
  // Tracked files only (what ships), under the rule's roots plus the root-level JSON files.
  const roots = ["README.md", "CHANGELOG.md", "RELEASE_NOTES.md", "NOTICE.md", "docs/", "src/", "runtime/", "scripts/", "examples/"];
  const ours = (f) => (roots.some((r) => f === r || f.startsWith(r)) || /^[^/]+\.json$/.test(f)) && !f.includes("/vendor/") && !/\.(png|jpg|webm|svg|pyc)$/.test(f);
  const files = run("git ls-files -z").split("\0").filter((f) => f && ours(f));
  const hits = [];
  for (const f of files) {
    readFileSync(join(ROOT, f), "utf8").split("\n").forEach((line, i) => {
      if (re.test(line) && !allow.some((a) => line.includes(a))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  return { ok: hits.length === 0, output: hits.length ? hits.join("\n") : `${files.length} tracked files clean` };
}

function browserAvailable() {
  if (process.env.BROWSER && existsSync(process.env.BROWSER)) return true;
  const known = ["/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  if (known.some((p) => existsSync(p))) return true;
  return ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"].some((b) => runCommand(`command -v ${b}`, { cwd: ROOT }).ok);
}

// A gate that is both a step and a signal: run once, record the log, parse the output.
function gate(key, label, cmd, parse, kind) {
  const out = h.step(key, label, cmd);
  signals[key] = parse(out);
  return out;
}

function fnGate(key, label, cmd, parse, kind) {
  h.fn(key, label, () => {
    const parsed = parse(run(cmd));
    signals[key] = parsed;
    const ok = kind === "eslint" ? !!parsed && parsed.errors === 0 : !!parsed;
    return { ok, output: describe(kind, parsed) };
  });
}

// ── The flow ──────────────────────────────────────────────────────────────────
if (noCargo) {
  for (const [k, l] of [["fmt", "rustfmt"], ["clippy", "clippy"], ["tests", "Rust unit tests"], ["audit", "cargo audit"]]) h.skip(k, l, "--no-cargo");
} else {
  gate("fmt", "rustfmt (cargo fmt --check)", CMD.fmt, parseFmt, "fmt");
  gate("clippy", "clippy (-D warnings)", CMD.clippy, parseClippy, "clippy");
  gate("tests", "Rust unit tests (cargo test)", CMD.tests, parseTests, "tests");
  if (auditAvailable()) gate("audit", "cargo audit", CMD.audit, parseAudit, "audit");
  else h.skip("audit", "cargo audit", "cargo-audit is not installed");
}
fnGate("eslint", "ESLint", CMD.eslint, parseEslint, "eslint");
fnGate("complexity", "Complexity debt of the runtime", CMD.complexity, parseComplexity, "complexity");
h.fn("syntax", "JavaScript syntax (node --check)", jsSyntax);
h.fn("data", "Data files + localization parity", dataFiles);
h.fn("launchers", "One-click launchers (.desktop Exec)", launchers);
h.fn("shipped-text", "Shipped-text rule", shippedText);
if (browserAvailable()) gate("harness", "Runtime harness (headless Chromium)", CMD.harness, parseHarness, "harness");
else h.skip("harness", "Runtime harness (headless Chromium)", "no Chromium-family browser found");
if (flag("--docker")) h.step("docker", "Container harness", "bash scripts/harness-docker.sh 2>&1");
if (flag("--qa")) h.step("qa-matrix", "QA matrix (containers + host harness)", "bash scripts/qa-matrix.sh 2>&1");

const counts = h.summary();
const { record, runs } = recordRun({ scope, ts: timestamp(), signals: { ...signals, ...cheapSignals() }, steps: h.steps, durations: h.durations() });
logSummary(record, runs);
process.exit(counts.failed ? 1 : 0);
