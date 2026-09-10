// Domain types + table-name handles for the itp_master_* tables
// (supabase/migrations/20260910040000_phase3_master_itp_library.sql).
//
// The enums below mirror those tables' CHECK constraints, the same way
// packages/shared-types/src/domain.ts mirrors the others (PartyType, InterventionLevel, etc.) — they
// belong there once that file can be touched (see this module's final report).
//
// None of these tables are in the generated Database type yet, so `.from()` can't resolve them
// against the Tables map. Casting the table name is the one place that gap leaks in, matching
// apps/web/lib/ncrs/types.ts's pattern exactly; every query still gets its real row shape back via
// an explicit `.returns<T>()` / typed `.single<T>()`, so nothing downstream works with untyped data.

/* eslint-disable @typescript-eslint/no-explicit-any -- narrow, documented escape hatch, see above */
export const ITP_MASTER_TEMPLATES_TABLE = "itp_master_templates" as any;
export const ITP_MASTER_SECTIONS_TABLE = "itp_master_sections" as any;
export const ITP_MASTER_ITEMS_TABLE = "itp_master_items" as any;
export const ITP_MASTER_PROPOSALS_TABLE = "itp_master_proposals" as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const ITP_MASTER_PROPOSED_ACTIONS = ["new_template", "update_existing"] as const;
export type ItpMasterProposedAction = (typeof ITP_MASTER_PROPOSED_ACTIONS)[number];

export const ITP_MASTER_PROPOSAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ItpMasterProposalStatus = (typeof ITP_MASTER_PROPOSAL_STATUSES)[number];

export interface ItpMasterTemplateRow {
  id: string;
  title: string;
  industry: string;
  discipline_id: string | null;
  applicable_standard: string | null;
  version: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItpMasterSectionRow {
  id: string;
  template_id: string;
  section_number: number;
  title: string;
  sort_order: number;
}

export interface ItpMasterItemRow {
  id: string;
  section_id: string;
  item_number: string;
  activity: string;
  reference_spec: string | null;
  acceptance_criteria: string | null;
  method: string | null;
  frequency: string | null;
  evidence_type: 1 | 2 | 3;
  sort_order: number;
}

export interface ItpMasterProposalRow {
  id: string;
  source_itp_id: string;
  proposed_action: ItpMasterProposedAction;
  target_template_id: string | null;
  proposed_title: string | null;
  proposal_notes: string | null;
  status: ItpMasterProposalStatus;
  proposed_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}
