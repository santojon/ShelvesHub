/* Step runner for the validate flow: each gate runs as a shell command or a
   function, and the harness keeps its status (pass / fail / skip), duration and
   log tail while printing a compact console trace — the shape the report
   renderer records (see scripts/ci/report.mjs). */
import { spawnSync } from "node:child_process";

export const C = { bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", dim: "\x1b[2m", reset: "\x1b[0m" };
const LOG_TAIL_LINES = 120;
const STEP_TIMEOUT_MS = 30 * 60 * 1000;

export function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

export function tail(text, lines = LOG_TAIL_LINES) {
  return String(text || "").replace(/\s+$/, "").split("\n").slice(-lines).join("\n");
}

// Run a shell command, merging stdout + stderr (what a reader of the step wants).
export function runCommand(command, { cwd, env = process.env, timeoutMs = STEP_TIMEOUT_MS } = {}) {
  const r = spawnSync(command, { cwd, env, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
  const output = (r.stdout || "") + (r.stderr || "") + (r.error ? `\n${r.error.message}` : "");
  return { ok: r.status === 0, output };
}

export class Harness {
  constructor(cwd) {
    this.cwd = cwd;
    this.steps = [];
    this.outputs = {};
  }

  _record(key, label, status, durationMs, output) {
    this.steps.push({ key, label, status, durationMs, log: tail(output) });
    this.outputs[key] = output;
    const secs = (durationMs / 1000).toFixed(1);
    const mark = status === "pass" ? `${C.green}✓ PASS` : status === "skip" ? `${C.yellow}– SKIP` : `${C.red}✗ FAIL`;
    process.stdout.write(`  ${mark}${C.reset} (${secs}s)\n`);
    if (status === "fail") {
      for (const line of tail(output, 20).split("\n")) process.stdout.write(`    ${C.dim}${line}${C.reset}\n`);
    }
  }

  // A shell step; returns its full output (for the signal parsers).
  step(key, label, command, opts = {}) {
    process.stdout.write(`${C.bold}▶ ${label}${C.reset}\n`);
    const start = Date.now();
    const { ok, output } = runCommand(command, { cwd: this.cwd, ...opts });
    this._record(key, label, ok ? "pass" : "fail", Date.now() - start, output);
    return output;
  }

  // A function step: `fn()` returns `{ ok, output }`; a throw is a failure.
  fn(key, label, fn) {
    process.stdout.write(`${C.bold}▶ ${label}${C.reset}\n`);
    const start = Date.now();
    let res;
    try {
      res = fn() || { ok: false, output: "no result" };
    } catch (e) {
      res = { ok: false, output: String(e && e.stack ? e.stack : e) };
    }
    this._record(key, label, res.ok ? "pass" : "fail", Date.now() - start, res.output || "");
    return res.output || "";
  }

  skip(key, label, reason = "") {
    process.stdout.write(`${C.bold}▶ ${label}${C.reset}\n`);
    this._record(key, label, "skip", 0, reason);
  }

  counts() {
    const n = (s) => this.steps.filter((x) => x.status === s).length;
    return { passed: n("pass"), failed: n("fail"), skipped: n("skip"), total: this.steps.length };
  }

  durations() {
    const d = {};
    let total = 0;
    for (const s of this.steps) {
      d[s.key] = s.durationMs;
      total += s.durationMs;
    }
    d.total = total;
    return d;
  }

  summary() {
    const c = this.counts();
    const color = c.failed ? C.red : C.green;
    process.stdout.write(`${C.bold}${color}${c.failed ? "FAIL" : "PASS"}${C.reset} · ${c.passed} passed, ${c.failed} failed, ${c.skipped} skipped of ${c.total} steps\n`);
    return c;
  }
}
