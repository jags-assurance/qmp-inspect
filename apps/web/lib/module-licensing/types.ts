// Domain types + table-name handle for `organization_module_licenses`
// (supabase/migrations/20260922080000_module_licensing.sql) — R112 per-client module licensing.
//
// Not in the generated Database type yet — same documented `"table" as any` cast used for every
// other table added after the last type generation (see lib/signoff/db-types.ts,
// lib/intervention-levels/types.ts). Every read/write here is still typed via an explicit
// `.returns<T>()` / `.single<T>()`.

/* eslint-disable @typescript-eslint/no-explicit-any -- narrow, documented escape hatch, see above */
export const ORGANIZATION_MODULE_LICENSES_TABLE = "organization_module_licenses" as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

// The fixed set of real, licensable feature areas — kept in lockstep with the DB CHECK constraint
// in the migration above, and with the nav items in app/inspect/layout.tsx this list was read from.
// Adding a module means updating all three together.
export const MODULE_KEYS = [
  "itps",
  "ncrs",
  "observations",
  "vault",
  "standalone_assignments",
  "registers",
  "data_book",
  "handover",
  "client_teams",
  "custom_roles",
  "reporting",
  "power_bi",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  itps: "ITPs",
  ncrs: "NCRs",
  observations: "Observations",
  vault: "Document Vault",
  standalone_assignments: "Standalone Assignments",
  registers: "Registers",
  data_book: "Data Book",
  handover: "Handover",
  client_teams: "Client Teams",
  custom_roles: "Custom Roles",
  reporting: "Reporting",
  power_bi: "Power BI",
};

export interface OrganizationModuleLicenseRow {
  id: string;
  organization_id: string;
  module_key: ModuleKey;
  is_licensed: boolean;
  created_at: string;
  updated_at: string;
}
