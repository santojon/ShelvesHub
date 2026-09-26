#!/usr/bin/env node
/* One-shot retroactive fill for the quality dashboard: writes a few reconstructed
   run records (from changelog history + known baselines) so the dashboard opens on
   a real trend, not a single point. Idempotent — only writes a milestone file that
   isn't already present, never clobbering a recorded run.
   Usage: node scripts/ci/backfill-reports.mjs */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPORTS = join(ROOT, "site", "reports");
const SCOPES = ["local", "ci", "release"];

// Reconstructed milestones (dates from the changelog; metrics from the release
// snapshot and the recorded suppression baselines). Marked reconstructed so the
// dashboard/readers can tell them apart from live runs.
const MILESTONES = [
  {
    ts: "2026-09-16_00-00-00",
    scope: "release",
    version: "0.1.0",
    overall: "PASS",
    reconstructed: true,
    tests: { passed: 39, failed: 0, skipped: 0, total: 39 },
    clippy: { warnings: 0, errors: 0, clean: true },
    harness: null,
    suppressions: {
      total: 573,
      byRule: {
        "no-var": 442,
        "ds-local/comment-length": 97,
        complexity: 28,
        "no-cond-assign": 4,
        eqeqeq: 1,
        "max-lines": 1,
      },
    },
    runtimeCodeLines: 1983,
  },
  {
    ts: "2026-09-24_00-00-00",
    scope: "ci",
    version: "0.1.0",
    overall: "PASS",
    reconstructed: true,
    tests: { passed: 47, failed: 0, skipped: 0, total: 47 },
    clippy: { warnings: 0, errors: 0, clean: true },
    harness: { passed: 8, failed: 0, total: 8 },
    suppressions: {
      total: 573,
      byRule: {
        "no-var": 442,
        "ds-local/comment-length": 97,
        complexity: 28,
        "no-cond-assign": 4,
        eqeqeq: 1,
        "max-lines": 1,
      },
    },
    runtimeCodeLines: 1983,
  },
  {
    ts: "2026-09-25_00-00-00",
    scope: "ci",
    version: "0.2.0",
    overall: "PASS",
    reconstructed: true,
    tests: { passed: 47, failed: 0, skipped: 0, total: 47 },
    clippy: { warnings: 0, errors: 0, clean: true },
    harness: { passed: 8, failed: 0, total: 8 },
    suppressions: {
      total: 81,
      byRule: { "ds-local/comment-length": 54, complexity: 27 },
    },
    runtimeCodeLines: 1980,
  },
];

function rebuildAggregate() {
  const runs = [];
  for (const sc of SCOPES) {
    const dir = join(REPORTS, sc);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        runs.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
      } catch {
        /* skip malformed */
      }
    }
  }
  runs.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  writeFileSync(join(REPORTS, "runs.json"), JSON.stringify(runs, null, 2) + "\n");
  return runs.length;
}

let wrote = 0;
for (const m of MILESTONES) {
  const dir = join(REPORTS, m.scope);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${m.ts}.json`);
  if (existsSync(file)) continue;
  writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
  wrote++;
}
const n = rebuildAggregate();
console.log(`[backfill] wrote ${wrote} milestone(s); aggregate has ${n} runs.`);
