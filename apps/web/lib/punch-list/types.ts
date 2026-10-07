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
  "itp_measurement_failure",
] as const;
export type PunchListSource = (typeof PUNCH_LIST_SOURCES)[number];

export const PUNCH_LIST_SOURCE_LABELS: Record<PunchListSource, string> = {
  inspection_failure: "Inspection failure",
  fat_conditional_pass: "FAT conditional pass",
  ncr: "NCR",
  walkdown: "Walkdown",
  manual: "Manual",
  itp_measurement_failure: "Measurement failure",
};

// R-verify-punch: added 'resolved' as a real middle state — the person who did the fix marks it
// resolved (with evidence), but a JAGS Admin or a close_punch_item permission holder has to
// independently verify and close it before it stops blocking the Data Book. See
// resolvePunchItemAction/closePunchItemAction in lib/punch-list/actions.ts.
export const PUNCH_LIST_STATUSES = ["open", "resolved", "closed"] as const;
export type PunchListStatus = (typeof PUNCH_LIST_STATUSES)[number];

export const PUNCH_LIST_PRIORITIES = ["A", "B", "C"] as const;
export type PunchListPriority = (typeof PUNCH_LIST_PRIORITIES)[number];
export const PUNCH_LIST_PRIORITY_LABELS: Record<PunchListPriority, string> = {
  A: "A - critical (before handover)",
  B: "B - major",
  C: "C - minor",
};
export const PUNCH_PHOTO_MAX_BYTES = 25 * 1024 * 1024;

export interface PunchListItemRow {
  priority: PunchListPriority;
  photo_paths: string[];
  created_by: string | null;
  reopen_reason: string | null;
  reopen_count: number;
  /** Photos of the fix, attached by the resolver (column punch_list_items.closing_photo_paths). */
  closing_photo_paths: string[];
  id: string;
  project_id: string;
  description: string;
  source: PunchListSource;
  source_inspection_record_id: string | null;
  source_standalone_assignment_id: string | null;
  source_ncr_id: string | null;
  source_itp_item_id: string | null;
  location: string | null;
  responsible_party_id: string | null;
  due_date: string | null;
  status: PunchListStatus;
  /** What was actually done to fix it — recorded at the resolve step, by whoever fixed it. */
  closing_evidence: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  /** The independent verifier's own notes at the verify-and-close step — distinct from
   *  closing_evidence, which is the fixer's own account. */
  verification_notes: string | null;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
}
