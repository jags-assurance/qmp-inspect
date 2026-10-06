// Domain types + table-name handle for `itp_revisions`
// (supabase/migrations/20260922020000_itp_revision_history.sql). Not in the generated Database
// type yet — same documented cast pattern as apps/web/lib/ncrs/types.ts and apps/web/lib/vault/types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const ITP_REVISIONS_TABLE = "itp_revisions" as any;

export interface ItpRevisionSnapshotItem {
  id: string;
  item_number: string;
  activity: string;
  acceptance_criteria: string | null;
  evidence_type: number;
  discipline_id: string | null;
  sort_order: number;
  // Added later: older snapshots won't have these.
  reference_spec?: string | null;
  method?: string | null;
  frequency?: string | null;
  notice_hours_override?: number | null;
  governing_drawing_document_id?: string | null;
  /** Sign-off level per party at the time of the snapshot (older snapshots have none). */
  interventions?: { project_party_id: string; party_name: string; intervention: string }[];
}

export interface ItpRevisionSnapshotSection {
  id: string;
  section_number: number;
  title: string;
  sort_order: number;
  items: ItpRevisionSnapshotItem[];
}

export interface ItpRevisionRow {
  id: string;
  itp_id: string;
  revision: number;
  title: string;
  scope: string | null;
  applicable_standard: string | null;
  sections_snapshot: ItpRevisionSnapshotSection[];
  reason: string | null;
  created_by: string | null;
  created_at: string;
}
