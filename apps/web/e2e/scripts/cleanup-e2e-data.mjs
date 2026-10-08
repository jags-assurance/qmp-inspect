#!/usr/bin/env node
/**
 * Removes the records the gated write specs (e2e/tests/05-*.spec.ts) created, and ONLY those: organisations
 * and projects whose names start with `E2E-` (see cleanup-select.mjs for the exact rules). Everything under
 * such a project (NCRs, punch items, inspections, IRNs, Data Books, certificates, ...) goes with it through
 * the database's own cascades. It never deletes by anything but the ids of rows that matched the E2E- rules.
 *
 *   DRY RUN (default): lists what would be removed and what was skipped; changes nothing.
 *   node e2e/scripts/cleanup-e2e-data.mjs
 *
 *   DELETE: only when E2E_CLEANUP_CONFIRM=1.
 *   E2E_CLEANUP_CONFIRM=1 node e2e/scripts/cleanup-e2e-data.mjs
 *
 * Environment:
 *   E2E_SUPABASE_URL, E2E_SUPABASE_SERVICE_ROLE_KEY   required (deliberately no fallback to the app's own env:
 *                                                    the project this touches must be chosen on purpose)
 *   E2E_CLEANUP_CONFIRM=1                            actually delete (anything else = dry run)
 *   E2E_RUN_TAG=E2E-...                              limit to one run's records (must start with E2E-)
 *   E2E_CLEANUP_STORAGE=1                            ALSO remove uploaded files: inspection-evidence/<E2E project id>/**
 *                                                    and generated-documents/handover/<E2E data book id>/**
 *   E2E_CLEANUP_MAX=20                               refuse to delete more than this many projects in one run
 *
 * The write suite's own fixture notes (e2e/.state/write-run.json) are removed after a confirmed delete.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { E2E_PREFIX, planCleanup } from "./cleanup-select.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(here, "..", ".state", "write-run.json");

const url = process.env.E2E_SUPABASE_URL?.trim();
const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY?.trim();
const confirmed = process.env.E2E_CLEANUP_CONFIRM === "1";
const withStorage = process.env.E2E_CLEANUP_STORAGE === "1";
const runTag = process.env.E2E_RUN_TAG?.trim() || null;
const maxProjects = Number(process.env.E2E_CLEANUP_MAX || 20);

if (!url || !key) {
  console.error("[e2e-cleanup] E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(2);
}
if (runTag && !runTag.startsWith(E2E_PREFIX)) {
  console.error(`[e2e-cleanup] E2E_RUN_TAG must start with ${E2E_PREFIX}.`);
  process.exit(2);
}

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const fail = (what, error) => {
  console.error(`[e2e-cleanup] ${what} failed: ${error?.message ?? error}`);
  process.exit(1);
};

console.log(`[e2e-cleanup] ${confirmed ? "DELETE MODE" : "dry run (nothing will be changed)"} against ${new URL(url).host}${runTag ? `, run ${runTag}` : ""}`);

// Candidate organisations: names starting E2E- (re-checked case-sensitively in planCleanup).
const orgQuery = await db.from("organizations").select("id, name").ilike("name", `${E2E_PREFIX}%`);
if (orgQuery.error) fail("listing organisations", orgQuery.error);
const organizations = orgQuery.data ?? [];

// Every project inside those organisations (E2E- or not, so an organisation holding a real project is never removed),
// plus any project named E2E-... elsewhere (reported, never removed).
const inOrgs = organizations.length
  ? await db.from("projects").select("id, name, project_number, organization_id").in("organization_id", organizations.map((o) => o.id))
  : { data: [], error: null };
if (inOrgs.error) fail("listing projects", inOrgs.error);
const named = await db.from("projects").select("id, name, project_number, organization_id").ilike("name", `${E2E_PREFIX}%`);
if (named.error) fail("listing E2E- named projects", named.error);
const projects = [...new Map([...(inOrgs.data ?? []), ...(named.data ?? [])].map((p) => [p.id, p])).values()];
// Organisations of projects found only by name (so planCleanup can tell they are not E2E- organisations).
const knownOrgIds = new Set(organizations.map((o) => o.id));
const strayOrgIds = [...new Set(projects.map((p) => p.organization_id).filter((id) => !knownOrgIds.has(id)))];
if (strayOrgIds.length) {
  const stray = await db.from("organizations").select("id, name").in("id", strayOrgIds);
  if (stray.error) fail("listing the organisations of E2E- named projects", stray.error);
  organizations.push(...(stray.data ?? []));
}

const plan = planCleanup({ organizations, projects, runTag });

const COUNTED = [
  ["ncrs", "project_id"],
  ["punch_list_items", "project_id"],
  ["inspection_records", "project_id"],
  ["irns", "project_id"],
  ["data_books", "project_id"],
];
async function describeProject(p) {
  const parts = [];
  for (const [table, column] of COUNTED) {
    const { data, error } = await db.from(table).select("id").eq(column, p.id).limit(1000);
    parts.push(`${table}=${error ? "?" : (data ?? []).length}`);
  }
  return parts.join(" ");
}

console.log(`\nOrganisations to remove: ${plan.organizations.length}`);
for (const o of plan.organizations) console.log(`  ${o.name}  (${o.id})`);
console.log(`Projects to remove: ${plan.projects.length}`);
for (const p of plan.projects) console.log(`  ${p.name} [${p.project_number}]  (${p.id})  ${await describeProject(p)}`);
if (plan.skipped.length) {
  console.log(`Left alone (${plan.skipped.length}):`);
  for (const s of plan.skipped) console.log(`  ${s.kind} "${s.name}" (${s.id}): ${s.reason}`);
}

if (!confirmed) {
  console.log("\nDry run only. Re-run with E2E_CLEANUP_CONFIRM=1 to delete the records listed above" + (withStorage ? " (and their stored files)." : "."));
  process.exit(0);
}
if (plan.projects.length > maxProjects) {
  console.error(`[e2e-cleanup] refusing to delete ${plan.projects.length} projects (limit ${maxProjects}); raise E2E_CLEANUP_MAX if that is really intended.`);
  process.exit(1);
}

/** Every file path under `prefix/` in a bucket (folders are listed recursively). Only ever called with an E2E project / book id. */
async function listAll(bucket, prefix) {
  const out = [];
  const walk = async (dir) => {
    const { data, error } = await db.storage.from(bucket).list(dir, { limit: 1000 });
    if (error) throw error;
    for (const entry of data ?? []) {
      const full = `${dir}/${entry.name}`;
      if (entry.id === null) await walk(full); // a folder
      else out.push(full);
    }
  };
  await walk(prefix);
  return out;
}

let failures = 0;
for (const p of plan.projects) {
  if (withStorage) {
    try {
      const evidence = await listAll("inspection-evidence", p.id);
      if (evidence.length) {
        const { error } = await db.storage.from("inspection-evidence").remove(evidence);
        if (error) throw error;
      }
      const books = await db.from("data_books").select("id").eq("project_id", p.id);
      for (const book of books.data ?? []) {
        const files = await listAll("generated-documents", `handover/${book.id}`);
        if (files.length) {
          const { error } = await db.storage.from("generated-documents").remove(files);
          if (error) throw error;
        }
      }
      console.log(`removed stored files of ${p.name}`);
    } catch (error) {
      failures += 1;
      console.error(`[e2e-cleanup] storage clean-up for ${p.name} failed: ${error?.message ?? error} (the project row is left in place)`);
      continue;
    }
  }
  const { error } = await db.from("projects").delete().eq("id", p.id);
  if (error) {
    failures += 1;
    console.error(`[e2e-cleanup] deleting project ${p.name} failed: ${error.message}`);
  } else {
    console.log(`deleted project ${p.name}`);
  }
}
for (const o of plan.organizations) {
  const { error } = await db.from("organizations").delete().eq("id", o.id);
  if (error) {
    failures += 1;
    console.error(`[e2e-cleanup] deleting organisation ${o.name} failed: ${error.message}`);
  } else {
    console.log(`deleted organisation ${o.name}`);
  }
}
if (failures === 0 && fs.existsSync(STATE_FILE)) fs.rmSync(STATE_FILE);
if (!withStorage && plan.projects.length) console.log("\nStored files were not touched (set E2E_CLEANUP_STORAGE=1 to remove inspection-evidence/<project id>/** and handover packages of the removed projects).");
process.exit(failures ? 1 : 0);
