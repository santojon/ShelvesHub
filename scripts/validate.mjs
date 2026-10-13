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
// `--only a,b`: run just those steps and print their verdicts (no report) — the CI's
// cheap inline gates reuse the same checks this way.
const only = opt("--only", "") ? opt("--only", "").split(",").map((s) => s.trim()).filter(Boolean) : null;
const wanted = (key) => !only || only.includes(key);
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
  if (!docs.keyParity) problems.push(`i18n key parity: ${docs.parityProblems.join(" · ")}`);
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
   tool names, the loader's name, internal phase labels and leaked Portuguese must
   not appear in committed text. The patterns and the interop allowlist are
   assembled from pieces so this file never matches its own check. */
const WORDS = new RegExp(["spr" + "int", "\\broa" + "dmap\\b", "\\bba" + "tch\\b", "\\bA\\.?I\\b", "de" + "cky", "\\bcla" + "ude\\b", "\\.cla" + "ude", "\\.roa" + "dmaps"].join("|"), "i");
// The loader's real globals the interop helper reads, and the owner value the harness asserts on.
const ALLOW = ["borrowedToaster", "De" + "ckyPluginLoader", "de" + "ckyHasLoaded", "de" + "ckyLoaderAPIInit", "de" + "ckyFrontendLib", "__DECK_SHELVES_OWNER__ = \"de" + "cky\"", "owner===\"de" + "cky\""];
// The lab's evidence records the renderer's owner value as data: that exact pair passes there only.
const EVIDENCE_DIR = "site/reports/qa/evidence/";
const OWNER_PAIR = new RegExp("^\\s*\"owner\": \"de" + "cky\",?$");
/* An internal phase label is a short upper-case prefix and a small number, dashed or
   not. Left alone: hashes and encodings (the prefixes below), display connector names,
   URL escapes, hex colours, architecture names (three letters and two digits), lint
   codes, identifiers, and SVG path data on a line that carries a path. */
const LABEL = /(?<![\w#%./-])(?:[A-Z]{1,3}-\d{1,3}|[A-Z]{1,2}\d{1,2})(?![\w-])/g;
const NOT_LABEL = /^(?:SHA|UTF|ISO|CVE|AES|RFC|MD|DSI|DP|HDMI|VGA|DVI|LVDS)-/;
// Product and key names shaped like a label: Apple silicon, function keys, consoles, a codec,
// release candidates, TLS versions, the X display server (split so this line passes too).
const NOT_TOKEN = new RegExp("^(?:M[1-4]|F" + "1[0-2]|PS[45]|AV" + "1|RC\\d|TLS-\\d|X" + "11)$");
const SVG_PATH = /\bd=["']|<path\b/;
// Portuguese that leaked outside the deliberate translations (docs/pt-BR, runtime/i18n,
// the site's own pt-BR strings). Each word carries a `~` so this line never matches itself.
const PORTUGUESE = new RegExp("(?<![a-zá-ú])(?:" + "n~ão|vo~cê|tam~bém|atra~vés|en~tão|a~té|s~ão|es~tá|es~tão|ocul~tar|verif~icar|rece~ntes|favo~ritos|a~bas|arqu~ivos?|usu~ários?|pad~rão|agu~arde|carre~gando|dispo~sitivo|diret~órios?|tempo~rários?|[a-zá-ú]+(?:ç~ão|ç~ões|s~ão|s~ões)".replace(/~/g, "") + ")(?![a-zá-ú])", "i");

function phaseLabel(line) {
  if (SVG_PATH.test(line)) return null;
  for (const m of line.match(LABEL) || []) if (!NOT_LABEL.test(m) && !NOT_TOKEN.test(m)) return m;
  return null;
}

const WORD = "process word, tool or loader name";
function textProblem(line, translated, evidence) {
  if (WORDS.test(line) && !ALLOW.some((a) => line.includes(a)) && !(evidence && OWNER_PAIR.test(line))) return WORD;
  const label = phaseLabel(line);
  if (label) return `internal phase label ${label}`;
  if (!translated && PORTUGUESE.test(line)) return "Portuguese outside the translations";
  return null;
}

/* The rules run against these lines before any file — each says what it must read as
   (null = clean; a third entry marks an evidence file), with the flagged pieces split
   so this file stays clean — so a loosened or over-eager pattern fails the step here. */
const SAMPLES = [
  ["Apple M1 and M2 Macs, press F12, a PS5 pad, RC1, TLS-1.3 only, X11 or Wayland", null],
  ["ES2020 UTF-8 ISO-8601 ARM64 HDMI-A-1 E0502 #DEADBEEF v1.2.3 HTTP 404 MUI2 %C2%B7", null],
  ["<path d=\"M1 2 L3 4\"/>", null],
  ["phase " + "F" + "4 of the plan", "internal phase label " + "F" + "4"],
  ["covers " + "ARM-" + "10, a minimal ARM distro", "internal phase label " + "ARM-" + "10"],
  ["the migration step (" + "H" + "6) ran", "internal phase label " + "H" + "6"],
  ["the roa" + "dmap for the spr" + "int", WORD],
  ["const guard = w.De" + "ckyPluginLoader;", null],
  ["    \"owner\": \"de" + "cky\",", WORD],
  ["    \"owner\": \"de" + "cky\",", null, true],
  ["    \"note\": \"de" + "cky owns it\",", WORD, true],
  ["Arqu" + "ivos tempor" + "ários do sistema", "Portuguese outside the translations"],
  ["the configuration file and its translations", null],
];
function ruleSelfCheck() {
  return SAMPLES.filter(([line, want, evidence]) => textProblem(line, false, !!evidence) !== want)
    .map(([line, want]) => `rule self-check: ${JSON.stringify(line)} should read ${want ?? "clean"}`);
}

// Tracked files only (what ships): every committed text root plus the root-level JSON files.
// Run records under site/reports/<scope>/ and the aggregates the quality run writes are the
// gates' own output, not authored text; the lab's evidence under site/reports/qa/ is scanned.
const GENERATED = /^site\/reports\/(?:(?:ci|release|local)\/|runs\.json$|qa\/matrix\.json$)/;
function shippedFiles() {
  const roots = ["README.md", "CHANGELOG.md", "RELEASE_NOTES.md", "NOTICE.md", "CODE_OF_CONDUCT.md", "CONTRIBUTING.md", "SECURITY.md", "build.rs", "Cargo.toml", "docs/", "src/", "runtime/", "scripts/", "examples/", "site/", "installer/", "docker/", ".github/"];
  const ours = (f) => (roots.some((r) => f === r || f.startsWith(r)) || /^[^/]+\.json$/.test(f)) && !f.includes("/vendor/") && !GENERATED.test(f) && !/\.(png|jpg|webm|svg|pyc|ico|woff2?)$/.test(f);
  return run("git ls-files -z").split("\0").filter((f) => f && ours(f));
}

function shippedText() {
  const files = shippedFiles();
  const hits = ruleSelfCheck();
  for (const f of files) {
    const translated = ["docs/pt-BR/", "runtime/i18n/", "site/", "scripts/build-site.mjs"].some((r) => f.startsWith(r));
    const evidence = f.startsWith(EVIDENCE_DIR);
    let text;
    try {
      text = readFileSync(join(ROOT, f), "utf8");
    } catch {
      continue; // tracked but deleted in the working tree: it will not ship
    }
    text.split("\n").forEach((line, i) => {
      const why = textProblem(line, translated, evidence);
      if (why) hits.push(`${f}:${i + 1}: ${why}: ${line.trim().slice(0, 100)}`);
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
function gate(key, label, cmd, parse) {
  if (!wanted(key)) return;
  signals[key] = parse(h.step(key, label, cmd));
}

function fnGate(key, label, cmd, parse, kind) {
  if (!wanted(key)) return;
  h.fn(key, label, () => {
    const parsed = parse(run(cmd));
    signals[key] = parsed;
    const ok = kind === "eslint" ? !!parsed && parsed.errors === 0 : !!parsed;
    return { ok, output: describe(kind, parsed) };
  });
}

function check(key, label, fn) {
  if (wanted(key)) h.fn(key, label, fn);
}

function skip(key, label, reason) {
  if (wanted(key)) h.skip(key, label, reason);
}

// ── The flow ──────────────────────────────────────────────────────────────────
if (noCargo) {
  for (const [k, l] of [["fmt", "rustfmt"], ["clippy", "clippy"], ["tests", "Rust unit tests"], ["audit", "cargo audit"]]) skip(k, l, "--no-cargo");
} else {
  gate("fmt", "rustfmt (cargo fmt --check)", CMD.fmt, parseFmt);
  gate("clippy", "clippy (-D warnings)", CMD.clippy, parseClippy);
  gate("tests", "Rust unit tests (cargo test)", CMD.tests, parseTests);
  if (auditAvailable()) gate("audit", "cargo audit", CMD.audit, parseAudit);
  else skip("audit", "cargo audit", "cargo-audit is not installed");
}
fnGate("eslint", "ESLint", CMD.eslint, parseEslint, "eslint");
fnGate("complexity", "Complexity debt of the runtime", CMD.complexity, parseComplexity, "complexity");
check("syntax", "JavaScript syntax (node --check)", jsSyntax);
check("data", "Data files + localization parity", dataFiles);
check("launchers", "One-click launchers (.desktop Exec)", launchers);
check("shipped-text", "Shipped-text rule", shippedText);
if (browserAvailable()) gate("harness", "Runtime harness (headless Chromium)", CMD.harness, parseHarness);
else skip("harness", "Runtime harness (headless Chromium)", "no Chromium-family browser found");
if (flag("--docker") && wanted("docker")) h.step("docker", "Container harness", "bash scripts/harness-docker.sh 2>&1");
if (flag("--qa") && wanted("qa-matrix")) h.step("qa-matrix", "QA matrix (containers + host harness)", "bash scripts/qa-matrix.sh 2>&1");

const counts = h.summary();
if (!only) {
  const { record, runs } = recordRun({ scope, ts: timestamp(), signals: { ...signals, ...cheapSignals() }, steps: h.steps, durations: h.durations() });
  logSummary(record, runs);
}
process.exit(counts.failed ? 1 : 0);
