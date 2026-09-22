"use client";

import { useActionState } from "react";
import { deleteLibraryItemAction, type LibraryItemFormState } from "@/lib/checklist-library/actions";
import type { ChecklistLibraryItemRow } from "@/lib/checklist-library/types";
import { Badge } from "@/components/ui/badge";

const initialState: LibraryItemFormState = { error: null };

function DeleteItemButton({ templateId, itemId }: { templateId: string; itemId: string }) {
  const [state, formAction, pending] = useActionState(deleteLibraryItemAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="item_id" value={itemId} />
      <button type="submit" disabled={pending} className="text-xs font-medium text-danger hover:underline disabled:opacity-50">
        {pending ? "Removing…" : "Remove"}
      </button>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}

export function ItemsTable({
  templateId,
  items,
  editable = true,
}: {
  templateId: string;
  items: ChecklistLibraryItemRow[];
  /** R46: false for a non-staff client viewer browsing a template visible to their org — read-only,
   *  no Remove action or column. */
  editable?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 font-medium">Acceptance criteria</th>
            <th className="px-3 py-2 font-medium">Evidence</th>
            <th className="px-3 py-2 font-medium">Mandatory</th>
            {editable && <th className="px-3 py-2 font-medium" />}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border last:border-0">
              <td className="doc-id px-3 py-2 text-ink">{item.item_number}</td>
              <td className="px-3 py-2 text-ink">{item.description}</td>
              <td className="px-3 py-2 text-muted">{item.acceptance_criteria ?? "—"}</td>
              <td className="px-3 py-2 text-muted">{item.evidence_type ?? "—"}</td>
              <td className="px-3 py-2">
                <Badge tone={item.is_mandatory ? "gold" : "neutral"}>{item.is_mandatory ? "Mandatory" : "Optional"}</Badge>
              </td>
              {editable && (
                <td className="px-3 py-2 text-right">
                  <DeleteItemButton templateId={templateId} itemId={item.id} />
                </td>
              )}
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={editable ? 6 : 5} className="px-3 py-8 text-center text-muted">
                {editable ? "No items yet — add one below or import from an Excel file." : "No items yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
