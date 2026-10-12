#!/usr/bin/env node
// Scores an AI ITP draft against expected-itp.json.
//
//   node docs/sample-itp-sources/verify-draft.mjs <draft.json> [--json]
//
// <draft.json> is the value of the hidden "draft_json" field on the "AI-assisted draft" page
// (DevTools > Elements, search draft_json, copy the value), saved to a file. Exit code 0 = PASS.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const oracle = JSON.parse(readFileSync(join(here, "expected-itp.json"), "utf8"));

export function verifyDraft(draft) {
  const items = (draft.sections ?? []).flatMap((s) =>
    (s.items ?? []).map((i) => ({ ...i, section: s.title }))
  );
  const rx = (s) => new RegExp(s, "i");
  const text = (i) => `${i.activity ?? ""} ${i.acceptanceCriteria ?? ""}`;
  const issues = [];
  const results = [];

  for (const exp of oracle.activities) {
    const candidates = items.filter((i) => exp.match.some((m) => rx(m).test(text(i))));
    // Best candidate = the one passing most checks.
    let best = null;
    for (const c of candidates) {
      const body = `${c.acceptanceCriteria ?? ""} ${c.method ?? ""} ${c.activity ?? ""}`;
      const checks = {
        // (?<![\d.]) stops "1 ohm" matching inside "10 ohm" or "0.5" inside "10.5".
        values: exp.values.every((v) => new RegExp(`(?<![\\d.])(?:${v})`, "i").test(body)),
        reference: rx(exp.refs).test(c.referenceSpec ?? ""),
        evidence: exp.evidence.includes(c.evidenceType),
        intervention:
          exp.intervention.length === 0 ||
          (c.suggestedInterventions ?? []).some((x) => exp.intervention.includes(x.intervention)),
      };
      const n = Object.values(checks).filter(Boolean).length;
      if (!best || n > best.n) best = { item: c, checks, n };
    }
    // A keyword hit alone is not coverage: the item must also carry the right values or reference.
    const found = !!best && (best.checks.values || best.checks.reference);
    results.push({ ...exp, found, best: found ? best : null });
  }

  // Grounding: every THP document number / IEC standard cited must exist in the sources.
  for (const i of items) {
    const ref = `${i.referenceSpec ?? ""} ${i.acceptanceCriteria ?? ""}`;
    for (const m of ref.matchAll(/THP-[A-Z]+(?:-[A-Z]+)?-\d{3}/g)) {
      if (!oracle.knownDocuments.includes(m[0])) issues.push(`Item ${i.itemNumber}: cites unknown document ${m[0]} (hallucinated?)`);
    }
    for (const m of ref.matchAll(/IEC\s*(\d{5})/g)) {
      if (!oracle.knownStandards.some((k) => k.endsWith(m[1]))) issues.push(`Item ${i.itemNumber}: cites IEC ${m[1]}, not in the sources`);
    }
    if (!(i.acceptanceCriteria ?? "").trim()) issues.push(`Item ${i.itemNumber}: empty acceptance criteria`);
    if (!(i.referenceSpec ?? "").trim()) issues.push(`Item ${i.itemNumber}: no reference`);
  }
  const nums = items.map((i) => i.itemNumber);
  for (const n of new Set(nums.filter((n, k) => nums.indexOf(n) !== k))) issues.push(`Duplicate item number ${n}`);

  const required = results.filter((r) => r.required);
  const coverage = required.filter((r) => r.found).length / required.length;
  const found = results.filter((r) => r.found);
  const checkTotals = found.reduce((a, r) => a + 4, 0);
  const checkPassed = found.reduce((a, r) => a + r.best.n, 0);
  const accuracy = checkTotals ? checkPassed / checkTotals : 0;
  const hallucinations = issues.filter((x) => /unknown document|not in the sources/.test(x)).length;
  const pass = coverage >= 0.9 && accuracy >= 0.75 && hallucinations === 0;

  return { pass, coverage, accuracy, itemCount: items.length, sectionCount: (draft.sections ?? []).length, results, issues };
}

function report(r) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  const out = [];
  out.push(`Sections: ${r.sectionCount}   Activities: ${r.itemCount}`);
  out.push(`Coverage of required activities: ${pct(r.coverage)}   Detail accuracy: ${pct(r.accuracy)}`);
  out.push("");
  for (const x of r.results) {
    if (!x.found) {
      out.push(`${x.required ? "MISSING " : "absent  "} ${x.id} ${x.name}`);
      continue;
    }
    const failed = Object.entries(x.best.checks).filter(([, ok]) => !ok).map(([k]) => k);
    out.push(`${failed.length ? "PARTIAL " : "OK      "} ${x.id} ${x.name}  -> item ${x.best.item.itemNumber}${failed.length ? `  (wrong: ${failed.join(", ")})` : ""}`);
  }
  if (r.issues.length) out.push("", "Issues:", ...r.issues.map((i) => `  - ${i}`));
  out.push("", r.pass ? "RESULT: PASS" : "RESULT: FAIL");
  return out.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node verify-draft.mjs <draft.json> [--json]");
    process.exit(2);
  }
  const r = verifyDraft(JSON.parse(readFileSync(file, "utf8")));
  console.log(process.argv.includes("--json") ? JSON.stringify(r, null, 2) : report(r));
  process.exit(r.pass ? 0 : 1);
}
