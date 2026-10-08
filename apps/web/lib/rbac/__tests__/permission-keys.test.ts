import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CLIENT_MANAGED_ONLY_PERMISSION_KEYS,
  CLIENT_SELF_SERVICE_PERMISSION_KEYS,
  PERMISSION_KEYS,
  PERMISSION_LABEL,
} from "../types";

// rbac/types.ts says PERMISSION_KEYS "must exactly match the check constraint on
// custom_role_permissions.permission_key". This test enforces that by reading the newest migration
// that (re)defines the constraint, so adding a key in one place and forgetting the other fails here
// instead of failing at runtime with a Postgres check violation when an admin grants the new key.
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../../../supabase/migrations");

function latestConstraintKeys(): { file: string; keys: string[] } {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of [...files].reverse()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const match = /custom_role_permissions_permission_key_check\s+check\s*\(\s*permission_key\s+in\s*\(([^)]*)\)/i.exec(sql);
    if (match) {
      const keys = [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      return { file, keys };
    }
  }
  throw new Error("No migration defines custom_role_permissions_permission_key_check");
}

describe("PERMISSION_KEYS", () => {
  it("has no duplicates", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("matches the database check constraint exactly (newest migration that defines it)", () => {
    const { file, keys } = latestConstraintKeys();
    expect(keys.length, `could not read the key list from ${file}`).toBeGreaterThan(0);
    expect([...PERMISSION_KEYS].sort()).toEqual([...keys].sort());
  });

  it("has a human label for every key and no label for an unknown key", () => {
    expect(Object.keys(PERMISSION_LABEL).sort()).toEqual([...PERMISSION_KEYS].sort());
    for (const label of Object.values(PERMISSION_LABEL)) expect(label.trim().length).toBeGreaterThan(0);
  });
});

describe("client self-service permission tiers", () => {
  const all = new Set<string>(PERMISSION_KEYS);

  it("only contain real permission keys", () => {
    for (const key of CLIENT_SELF_SERVICE_PERMISSION_KEYS) expect(all.has(key)).toBe(true);
    for (const key of CLIENT_MANAGED_ONLY_PERMISSION_KEYS) expect(all.has(key)).toBe(true);
  });

  it("never overlap: a key a plain self-managed org may grant is not also client-managed-only", () => {
    const managedOnly = new Set<string>(CLIENT_MANAGED_ONLY_PERMISSION_KEYS);
    for (const key of CLIENT_SELF_SERVICE_PERMISSION_KEYS) expect(managedOnly.has(key)).toBe(false);
  });

  it("keep the independent-assurance controls out of client hands", () => {
    // These decide who can sign off quality outcomes or hand over the Data Book; a client must never
    // be able to grant them to itself, at either tier.
    const clientGrantable = new Set<string>([...CLIENT_SELF_SERVICE_PERMISSION_KEYS, ...CLIENT_MANAGED_ONLY_PERMISSION_KEYS]);
    for (const key of ["issue_irn", "close_ncr", "approve_vault_document", "close_punch_item", "manage_intervention_levels", "issue_handover"]) {
      expect(clientGrantable.has(key), `${key} must stay JAGS-Admin-grantable only`).toBe(false);
    }
  });
});
