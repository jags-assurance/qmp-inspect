// Domain types + table-name handles for the tables added in
// supabase/migrations/20260909240000_phase1_checklists_inspections.sql.
//
// None of these tables are in the generated Database type yet, so `.from()` can't resolve them
// against the Tables map. Casting each table name here is the one place that gap leaks in — the
// same approach as NCRS_TABLE in lib/ncrs/types.ts, a different feature landing on the same schema
// gap. Every query still gets its real row shape back via an explicit `.returns<T>()` / typed
// `.single<T>()` / `.maybeSingle<T>()`, so nothing downstream of this file works with untyped data.

/* eslint-disable @typescript-eslint/no-explicit-any -- narrow, documented escape hatch, see above */
export const CHECKLIST_TEMPLATES_TABLE = "checklist_templates" as any;
export const CHECKLIST_ITEMS_TABLE = "checklist_items" as any;
export const INSPECTION_RECORDS_TABLE = "inspection_records" as any;
export const CHECKLIST_RESPONSES_TABLE = "checklist_responses" as any;
export const INSPECTION_PHOTOS_TABLE = "inspection_photos" as any;
export const IRNS_TABLE = "irns" as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ChecklistTemplateRow {
  id: string;
  itp_item_id: string;
  checklist_number: string;
  name: string;
  created_at: string;
}

export interface ChecklistItemRow {
  id: string;
  template_id: string;
  item_number: string;
  description: string;
  is_mandatory: boolean;
  sort_order: number;
  created_at: string;
  /** Populated when this item was copied in by attachLibraryTemplateToActivityAction
   *  (lib/checklist-library/actions.ts, see 20260922070000_checklist_library.sql); null for an
   *  item created by the pre-existing auto-generate or add-one-at-a-time paths. */
  acceptance_criteria?: string | null;
  evidence_type?: string | null;
}

export type OverallResult = "pass" | "fail" | "partial";

export interface InspectionRecordRow {
  id: string;
  project_id: string;
  itp_item_id: string;
  checklist_template_id: string | null;
  record_number: string;
  project_name: string;
  itp_number: string;
  activity: string;
  location: string | null;
  inspection_date: string;
  inspector_id: string | null;
  inspector_signature: string | null;
  overall_result: OverallResult | null;
  notes: string | null;
  narrative: string | null;
  created_at: string;
}

export type ChecklistResponseResult = "yes" | "no" | "na";

export interface ChecklistResponseRow {
  id: string;
  inspection_record_id: string;
  checklist_item_id: string;
  result: ChecklistResponseResult;
  comment: string | null;
  /** Which calibration_register instrument the inspector actually used for this response, if any —
   *  see supabase/migrations/20260920010000_material_traceability_and_tool_linkage.sql. Only
   *  meaningful for a calibration-kind registerVerification (registers/verify.ts). */
  calibration_asset_id: string | null;
  created_at: string;
}

export interface InspectionPhotoRow {
  id: string;
  inspection_record_id: string;
  storage_path: string;
  caption: string | null;
  uploaded_by: string | null;
  /** Optional link to the specific checklist item/finding this photo documents. Null for photos
   *  attached generically to the whole inspection (the original, still-supported behaviour). */
  checklist_item_id: string | null;
  created_at: string;
}

export interface IrnRow {
  id: string;
  inspection_record_id: string;
  irn_number: string;
  release_date: string;
  issued_by: string | null;
  created_at: string;
}
