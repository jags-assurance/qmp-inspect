// Domain types + table-name handle for the `ncrs` table (supabase/migrations/20260909250000_phase1_ncr.sql).
//
// The severity/status enums below mirror that table's CHECK constraints, the same way
// packages/shared-types/src/domain.ts mirrors the others (PartyType, InterventionLevel, etc.) —
// they belong there once that file can be touched (see the NCR module's final report).
//
// `ncrs` isn't in the generated Database type yet, so `.from()` can't resolve it against the
// Tables map. Casting the table name here is the one place that gap leaks in; every query still
// gets its real row shape back via an explicit `.returns<T>()` / typed `.single<T>()`, so nothing
// downstream of this file works with untyped data.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const NCRS_TABLE = "ncrs" as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const NCR_PHOTOS_TABLE = "ncr_photos" as any;

export const NCR_SEVERITIES = ["observation", "minor_ncr", "major_ncr"] as const;
export type NcrSeverity = (typeof NCR_SEVERITIES)[number];

export const NCR_STATUSES = ["open", "in_progress", "pending_verification", "closed"] as const;
export type NcrStatus = (typeof NCR_STATUSES)[number];

export interface NcrRow {
  id: string;
  project_id: string;
  itp_item_id: string | null;
  inspection_record_id: string | null;
  ncr_number: string;
  severity: NcrSeverity;
  description: string;
  requirement_not_met: string | null;
  status: NcrStatus;
  assigned_to: string | null;
  due_date: string | null;
  root_cause: string | null;
  corrective_action: string | null;
  preventive_action: string | null;
  verification_notes: string | null;
  raised_by: string | null;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NcrPhotoRow {
  id: string;
  ncr_id: string;
  storage_path: string;
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
}
