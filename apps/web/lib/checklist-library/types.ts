// Domain types + table-name handles for the checklist_library_* tables
// (supabase/migrations/20260922070000_checklist_library.sql).
//
// None of these tables are in the generated Database type yet, so `.from()` can't resolve them
// against the Tables map. Casting the table name is the one place that gap leaks in, matching
// apps/web/lib/itp-master/types.ts's pattern exactly; every query still gets its real row shape back
// via an explicit `.returns<T>()` / typed `.single<T>()` / `.maybeSingle<T>()`.

/* eslint-disable @typescript-eslint/no-explicit-any -- narrow, documented escape hatch, see above */
export const CHECKLIST_LIBRARY_TEMPLATES_TABLE = "checklist_library_templates" as any;
export const CHECKLIST_LIBRARY_ITEMS_TABLE = "checklist_library_items" as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ChecklistLibraryTemplateRow {
  id: string;
  title: string;
  discipline_id: string | null;
  description: string | null;
  /** R46: null = global/shared across every client (the original, still-default behavior); a set
   *  value scopes this template to one client organisation, so JAGS can keep distinct checklist
   *  variants per client without them colliding in the shared library. */
  organization_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistLibraryItemRow {
  id: string;
  library_template_id: string;
  item_number: string;
  description: string;
  acceptance_criteria: string | null;
  evidence_type: string | null;
  is_mandatory: boolean;
  sort_order: number;
  /** 20261113000500: 'pass_fail' (default) or 'numeric' with optional limits and unit. */
  value_type?: string;
  numeric_min?: number | null;
  numeric_max?: number | null;
  numeric_unit?: string | null;
  created_at: string;
}

/** A row parsed from an uploaded .xlsx (or drafted by hand) but not yet committed as a real
 *  checklist_library_items row — the shape shuttled through the preview-and-validate step. */
export interface ParsedLibraryItemRow {
  item_number: string;
  description: string;
  acceptance_criteria: string;
  evidence_type: string;
  is_mandatory: boolean;
  /** Null when the row is well-formed; otherwise the reason it can't be committed as-is (R47:
   *  surfaced to the reviewer, never silently dropped or silently accepted). */
  validationError: string | null;
}

/** The exact column order used by both the .xlsx export and the .xlsx import parser, so a
 *  downloaded template round-trips through re-upload without the user needing to know the shape. */
export const CHECKLIST_TEMPLATE_XLSX_COLUMNS = [
  "Item Number",
  "Description",
  "Acceptance Criteria",
  "Evidence Type",
  "Mandatory",
] as const;
