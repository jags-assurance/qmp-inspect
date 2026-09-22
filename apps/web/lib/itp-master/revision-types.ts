// Domain types + table-name handle for `itp_master_revisions`
// (supabase/migrations/20260925020000_master_itp_revision_history.sql). Not in the generated
// Database type yet — same documented cast pattern as apps/web/lib/itps/revision-types.ts (R101),
// which this module is the master-library equivalent of (R31).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const ITP_MASTER_REVISIONS_TABLE = "itp_master_revisions" as any;

export interface ItpMasterRevisionSnapshotItem {
  id: string;
  item_number: string;
  activity: string;
  acceptance_criteria: string | null;
  evidence_type: number;
  discipline_id: string | null;
  sort_order: number;
}

export interface ItpMasterRevisionSnapshotSection {
  id: string;
  section_number: number;
  title: string;
  sort_order: number;
  items: ItpMasterRevisionSnapshotItem[];
}

export interface ItpMasterRevisionRow {
  id: string;
  template_id: string;
  version: number;
  title: string;
  industry: string;
  applicable_standard: string | null;
  sections_snapshot: ItpMasterRevisionSnapshotSection[];
  reason: string | null;
  created_by: string | null;
  created_at: string;
}
