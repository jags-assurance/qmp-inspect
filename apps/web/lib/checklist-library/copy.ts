// Not a "use server" file: pure helper for the non-atomic fallback of attachLibraryTemplateToActivityAction.
import type { ChecklistLibraryItemRow } from "./types";

/** Library item columns copied onto a real checklist item. The numeric_* / value_type columns only exist
 *  once 20261113000500 is applied; the action retries without them until then. */
export const LIBRARY_ITEM_BASE_COLUMNS =
  "item_number, description, acceptance_criteria, evidence_type, is_mandatory, sort_order";
export const LIBRARY_ITEM_COLUMNS = `${LIBRARY_ITEM_BASE_COLUMNS}, value_type, numeric_min, numeric_max, numeric_unit`;

export type LibraryItemForCopy = Pick<
  ChecklistLibraryItemRow,
  "item_number" | "description" | "acceptance_criteria" | "evidence_type" | "is_mandatory" | "sort_order"
> &
  Partial<Pick<ChecklistLibraryItemRow, "value_type" | "numeric_min" | "numeric_max" | "numeric_unit">>;

/** Row to insert into checklist_items, matching what attach_library_template_atomic copies
 *  (value_type, numeric_min, numeric_max, numeric_unit are carried when the library item has them). */
export function libraryItemToChecklistItem(templateId: string, item: LibraryItemForCopy) {
  return {
    template_id: templateId,
    item_number: item.item_number,
    description: item.description,
    acceptance_criteria: item.acceptance_criteria,
    evidence_type: item.evidence_type,
    is_mandatory: item.is_mandatory,
    sort_order: item.sort_order,
    ...(item.value_type !== undefined
      ? {
          value_type: item.value_type,
          numeric_min: item.numeric_min ?? null,
          numeric_max: item.numeric_max ?? null,
          numeric_unit: item.numeric_unit ?? null,
        }
      : {}),
  };
}
