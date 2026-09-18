// Domain types + table-name handles for the tables added in
// supabase/migrations/20260910000000_phase1_signoff_chain.sql.
//
// Neither table is in the generated Database type yet, so `.from()` can't resolve them against the
// Tables map. Casting each table name here is the one place that gap leaks in — the same approach
// as NCRS_TABLE in lib/ncrs/types.ts and the CHECKLIST_*_TABLE constants in
// lib/checklists/db-types.ts. Every query still gets its real row shape back via an explicit
// `.returns<T>()` / typed `.single<T>()` / `.maybeSingle<T>()`, so nothing downstream of this file
// works with untyped data.

/* eslint-disable @typescript-eslint/no-explicit-any -- narrow, documented escape hatch, see above */
export const NOTICE_PERIOD_CONFIGS_TABLE = "notice_period_configs" as any;
export const ACTIVITY_SIGNOFF_PROGRESS_TABLE = "activity_signoff_progress" as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const SIGNOFF_STATUSES = ["pending", "notified", "signed_off", "proceeded_no_response"] as const;
export type SignoffStatus = (typeof SIGNOFF_STATUSES)[number];

// Fallback notice periods (hours) — used only when NEITHER a project's notice_period_configs row
// NOR the organisation's own intervention_level_types.default_notice_hours has a value for the
// given code. R66-R81 documents 48h/24h as the Hold/Witness defaults; kept here (re-exported from
// lib/intervention-levels/types.ts, the new source of truth) purely so existing imports of this
// name keep working. Shared (not just internal to actions.ts) so anything computing "is this
// Hold/Witness overdue" (e.g. the Inspector dashboard's "Overdue hold points" stat) uses the exact
// same threshold as the actions that actually enforce it.
export { FALLBACK_NOTICE_PERIOD_HOURS as DEFAULT_NOTICE_PERIOD_HOURS } from "@/lib/intervention-levels/types";

export interface NoticePeriodConfigRow {
  id: string;
  project_id: string;
  /** Any of this project's organisation's configured intervention_level_types codes — no longer
   *  restricted to "H" | "W" now that a custom level can also get a per-project notice-period
   *  override. */
  intervention: string;
  hours: number;
}

export interface ActivitySignoffProgressRow {
  id: string;
  itp_item_id: string;
  project_party_id: string;
  /** Any of this activity's organisation's configured intervention_level_types codes — no longer a
   *  fixed "H" | "W" | "R" | "S" enum, see supabase/migrations/
   *  20260917090000_configurable_intervention_levels.sql. */
  intervention: string;
  status: SignoffStatus;
  notified_at: string | null;
  signed_off_at: string | null;
  signed_off_by: string | null;
  proceeded_reason: string | null;
  proceeded_at: string | null;
  created_at: string;
  updated_at: string;
}
