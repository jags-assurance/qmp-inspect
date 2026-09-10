// Domain types + table-name handle for the `punch_list_items` table
// (supabase/migrations/20260910010000_phase1_punch_list_databook_handover.sql).
//
// This is the project-wide punch list register (Reqs R95-R96) — distinct from
// standalone_assignment_punch_items, which is the existing per-assignment list scoped to a single
// FAT/witness/etc. This one aggregates outstanding items from every source across a project.
//
// The enums below mirror that table's CHECK constraints, the same way packages/shared-types/src/
// domain.ts mirrors the others — they belong there once that file can be touched (see this
// module's final report).
//
// `punch_list_items` isn't in the generated Database type yet, so `.from()` can't resolve it
// against the Tables map. Casting the table name here is the one place that gap leaks in; every
// query still gets its real row shape back via an explicit `.returns<T>()` / typed `.single<T>()`,
// so nothing downstream of this file works with untyped data.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const PUNCH_LIST_ITEMS_TABLE = "punch_list_items" as any;

export const PUNCH_LIST_SOURCES = [
  "inspection_failure",
  "fat_conditional_pass",
  "ncr",
  "walkdown",
  "manual",
] as const;
export type PunchListSource = (typeof PUNCH_LIST_SOURCES)[number];

export const PUNCH_LIST_SOURCE_LABELS: Record<PunchListSource, string> = {
  inspection_failure: "Inspection failure",
  fat_conditional_pass: "FAT conditional pass",
  ncr: "NCR",
  walkdown: "Walkdown",
  manual: "Manual",
};

export const PUNCH_LIST_STATUSES = ["open", "closed"] as const;
export type PunchListStatus = (typeof PUNCH_LIST_STATUSES)[number];

export interface PunchListItemRow {
  id: string;
  project_id: string;
  description: string;
  source: PunchListSource;
  source_inspection_record_id: string | null;
  source_standalone_assignment_id: string | null;
  source_ncr_id: string | null;
  location: string | null;
  responsible_party_id: string | null;
  due_date: string | null;
  status: PunchListStatus;
  closing_evidence: string | null;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
}
