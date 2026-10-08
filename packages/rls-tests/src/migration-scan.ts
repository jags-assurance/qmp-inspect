/**
 * Static scan of supabase/migrations for the database write guards the suites must account for.
 * Pure file parsing: no database, no network, no environment. Used by coverage.test.ts (the guard ->
 * test coverage table) and importable from anywhere else that wants the same list.
 *
 * What counts as a guard (migrations from FIRST_MIGRATION onward, i.e. the Stage 1+ hardening):
 *   - trigger functions: every function that a `create trigger ... execute function public.<fn>()`
 *     statement in range points at, plus every `create function ... returns trigger` defined in range.
 *     (Triggers created through `execute format('create trigger ...')` inside a DO block are found too,
 *     because the statement text is still present in the file.)
 *   - unique indexes created in range (the database-level duplicate guards, e.g. ncrs request_id).
 *   - tables that received a non-SELECT row-level-security policy in range (the write policies).
 */
import fs from "node:fs";
import path from "node:path";

export const FIRST_MIGRATION = "20261015S40001";

export const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");

export type GuardKind = "trigger_fn" | "unique_index" | "policy_table";

export interface FoundGuard {
  kind: GuardKind;
  name: string;
  /** Migration file names (without directory) that mention it, in order. */
  migrations: string[];
}

/** Supabase orders migrations by their version string; plain string order matches it for these names. */
export function migrationFilesInRange(dir: string = MIGRATIONS_DIR): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .filter((f) => f >= FIRST_MIGRATION);
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
}

export function scanGuards(dir: string = MIGRATIONS_DIR): FoundGuard[] {
  const found = new Map<string, FoundGuard>();
  const add = (kind: GuardKind, name: string, file: string) => {
    const key = `${kind}:${name}`;
    const existing = found.get(key);
    if (existing) {
      if (!existing.migrations.includes(file)) existing.migrations.push(file);
    } else {
      found.set(key, { kind, name, migrations: [file] });
    }
  };

  for (const file of migrationFilesInRange(dir)) {
    const sql = stripComments(fs.readFileSync(path.join(dir, file), "utf8"));

    // create trigger <name> ... execute function public.<fn>(   (statement may span lines; '' for quotes inside format())
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?trigger\s+[\w"]+[\s\S]*?execute\s+(?:function|procedure)\s+(?:public\.)?(\w+)\s*\(/gi)) {
      add("trigger_fn", m[1], file);
    }
    // create [or replace] function [public.]<fn>( ... ) returns trigger
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\([^)]*\)\s*returns\s+trigger/gi)) {
      add("trigger_fn", m[1], file);
    }
    for (const m of sql.matchAll(/create\s+unique\s+index\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)) {
      add("unique_index", m[1], file);
    }
    for (const m of sql.matchAll(/create\s+policy\s+"?\w+"?\s+on\s+([\w.]+)\s*(?:as\s+\w+\s+)?(?:for\s+(select|insert|update|delete|all))?/gi)) {
      const cmd = (m[2] ?? "all").toLowerCase();
      if (cmd === "select") continue;
      add("policy_table", m[1].replace(/^public\./, ""), file);
    }
  }
  return [...found.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind)));
}
