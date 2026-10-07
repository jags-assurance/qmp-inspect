#!/usr/bin/env node
/**
 * Turns Playwright's JSON report (e2e/test-results/results.json) into Markdown: totals, then one
 * table per spec file with pass / FAIL / skipped per test, the failure message and any skip reason.
 * It reports what the run recorded and nothing else, so a failure is never hidden by a summary.
 *
 *   node e2e/scripts/summarize-results.mjs [path/to/results.json]   (prints Markdown to stdout)
 *
 * Used by `pnpm --filter @jags/web e2e:report`, by CI (job summary) and to write
 * docs/E2E_RUN_RESULTS.md.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = process.argv.length > 2 ? process.argv.slice(2) : [path.join(here, "..", "test-results", "results.json")];
// Several JSON files (parallel runs) are merged into one report.
const reports = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const report = {
  suites: reports.flatMap((r) => r.suites ?? []),
  stats: {
    startTime: reports.map((r) => r.stats?.startTime).filter(Boolean).sort()[0],
    duration: Math.max(...reports.map((r) => r.stats?.duration ?? 0)),
  },
};

const rows = [];
function walk(suite, trail) {
  const here = suite.title && !suite.title.endsWith(".ts") ? [...trail, suite.title] : trail;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const results = test.results ?? [];
      const last = results[results.length - 1];
      const status = test.status === "expected" ? "pass" : test.status === "skipped" ? "skipped" : test.status === "flaky" ? "flaky" : "FAIL";
      const message = (last?.error?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n").slice(0, 4).join(" ").slice(0, 400);
      const skipReason = (test.annotations ?? []).find((a) => a.type === "skip")?.description ?? "";
      rows.push({
        file: suite.file ?? trail.file,
        group: here.join(" > "),
        title: spec.title,
        status,
        ms: results.reduce((sum, r) => sum + (r.duration ?? 0), 0),
        message,
        skipReason,
        notes: (test.annotations ?? []).filter((a) => a.type !== "skip").map((a) => `${a.type}: ${a.description ?? ""}`),
      });
    }
  }
  for (const child of suite.suites ?? []) walk({ ...child, file: child.file ?? suite.file }, here);
}
for (const top of report.suites ?? []) walk(top, []);

const count = (s) => rows.filter((r) => r.status === s).length;
const out = [];
out.push(`**${rows.length} tests: ${count("pass")} passed, ${count("FAIL")} failed, ${count("skipped")} skipped${count("flaky") ? `, ${count("flaky")} flaky` : ""}.**`);
out.push("");
out.push(`Run started ${report.stats?.startTime ?? "unknown"}; wall time ${Math.round((report.stats?.duration ?? 0) / 1000)} s.`);

const byFile = new Map();
for (const row of rows) {
  if (!byFile.has(row.file)) byFile.set(row.file, []);
  byFile.get(row.file).push(row);
}
for (const [spec, list] of byFile) {
  const failed = list.filter((r) => r.status === "FAIL").length;
  const skipped = list.filter((r) => r.status === "skipped").length;
  out.push("");
  out.push(`### ${spec}  (${list.length - failed - skipped} pass, ${failed} fail, ${skipped} skipped)`);
  out.push("");
  out.push("| Group | Test | Result | Detail |");
  out.push("|---|---|---|---|");
  for (const r of list) {
    const detail = r.status === "FAIL" ? r.message : r.status === "skipped" ? r.skipReason : "";
    out.push(`| ${r.group} | ${r.title} | ${r.status} | ${detail.replace(/\|/g, "\\|")} |`);
  }
}

// Console errors repeat on every page; collapse them to unique messages with a page count.
const consoleCounts = new Map();
const notes = [];
for (const r of rows) {
  for (const n of r.notes) {
    if (n.startsWith("console-error:")) {
      const message = n.replace(/^console-error: [^:]+: /, "").split("\n")[0].slice(0, 200);
      consoleCounts.set(message, (consoleCounts.get(message) ?? 0) + 1);
    } else {
      notes.push(`- ${r.group} > ${r.title}: ${n}`);
    }
  }
}
if (notes.length || consoleCounts.size) {
  out.push("");
  out.push("### Annotations recorded during the run");
  out.push("");
  out.push(...notes);
  for (const [message, count] of consoleCounts) out.push(`- Browser console error seen on ${count} page load(s): ${message}`);
}
console.log(out.join("\n"));
