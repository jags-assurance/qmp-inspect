#!/usr/bin/env node
// CI guard (docs/MIGRATION_REPAIR.md): fails if a NEW migration file does not have a pure
// 14-digit numeric version (YYYYMMDDHHMMSS_description.sql) or reuses an existing version.
//
// `supabase db push` ignores or rejects non-numeric versions, and duplicate versions collide in
// supabase_migrations.schema_migrations (version is the primary key). The repo already contains
// 30 legacy non-numeric names and 7 duplicate versions (applied by hand, never renamed). Those are
// grandfathered in scripts/migration-names-baseline.json; anything not listed there must be clean.
//
// Usage: node scripts/check-migration-names.mjs
//        node scripts/check-migration-names.mjs --print-baseline   (regenerate the baseline; do not
//        do this to silence a failure, fix the new file's name instead)

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "supabase", "migrations");
const baselinePath = join(root, "scripts", "migration-names-baseline.json");

const NUMERIC = /^(\d{14})_[A-Za-z0-9_.-]+\.sql$/;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

function analyse(list) {
  const nonNumeric = list.filter((f) => !NUMERIC.test(f));
  const byVersion = new Map();
  for (const f of list) {
    const m = NUMERIC.exec(f);
    if (!m) continue;
    byVersion.set(m[1], [...(byVersion.get(m[1]) ?? []), f]);
  }
  const duplicates = [...byVersion.values()].filter((v) => v.length > 1).flat();
  return { nonNumeric, duplicates };
}

if (process.argv.includes("--print-baseline")) {
  const { nonNumeric, duplicates } = analyse(files);
  console.log(JSON.stringify({ nonNumeric, duplicates }, null, 2));
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const allowedNonNumeric = new Set(baseline.nonNumeric);
const allowedDuplicates = new Set(baseline.duplicates);
const { nonNumeric, duplicates } = analyse(files);

const problems = [
  ...nonNumeric
    .filter((f) => !allowedNonNumeric.has(f))
    .map((f) => `${f}: version must be exactly 14 digits (YYYYMMDDHHMMSS_name.sql)`),
  ...duplicates
    .filter((f) => !allowedDuplicates.has(f))
    .map((f) => `${f}: version collides with another migration file`),
];

if (problems.length > 0) {
  console.error("Migration naming check failed:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\nRename the NEW file(s) (never rename already-applied ones). See docs/MIGRATION_REPAIR.md.");
  process.exit(1);
}

console.log(
  `Migration naming OK: ${files.length} files (${nonNumeric.length} grandfathered non-numeric, ${duplicates.length} grandfathered duplicate-version files).`
);
