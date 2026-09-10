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

export interface NoticePeriodConfigRow {
  id: string;
  project_id: string;
  intervention: "H" | "W";
  hours: number;
}

export interface ActivitySignoffProgressRow {
  id: string;
  itp_item_id: string;
  project_party_id: string;
  intervention: "H" | "W" | "R" | "S";
  status: SignoffStatus;
  notified_at: string | null;
  signed_off_at: string | null;
  signed_off_by: string | null;
  proceeded_reason: string | null;
  created_at: string;
  updated_at: string;
}
