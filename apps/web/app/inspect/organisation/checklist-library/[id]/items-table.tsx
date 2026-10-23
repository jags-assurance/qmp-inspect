"use client";

import { useActionState } from "react";
import { deleteLibraryItemAction, type LibraryItemFormState } from "@/lib/checklist-library/actions";
import type { ChecklistLibraryItemRow } from "@/lib/checklist-library/types";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: LibraryItemFormState = { error: null };

function DeleteItemButton({ templateId, itemId }: { templateId: string; itemId: string }) {
  const [state, formAction, pending] = useActionState(deleteLibraryItemAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <form onSubmit={keepValuesSubmit}>
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="item_id" value={itemId} />
      <Button type="submit" disabled={pending} variant="link-danger" size="sm">
        {pending ? "Removing…" : "Remove"}
      </Button>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
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
  const columns: ResponsiveColumn<ChecklistLibraryItemRow>[] = [
    { key: "item", header: "Item", tdClassName: "doc-id text-ink", render: (item) => item.item_number },
    { key: "description", header: "Description", tdClassName: "text-ink", render: (item) => item.description },
    { key: "criteria", header: "Acceptance criteria", tdClassName: "text-muted", render: (item) => item.acceptance_criteria ?? "—" },
    { key: "evidence", header: "Evidence", tdClassName: "text-muted", render: (item) => item.evidence_type ?? "—" },
    {
      key: "mandatory",
      header: "Mandatory",
      render: (item) => <Badge tone={item.is_mandatory ? "gold" : "neutral"}>{item.is_mandatory ? "Mandatory" : "Optional"}</Badge>,
    },
    ...(editable
      ? [
          {
            key: "delete",
            header: "Delete",
            srOnlyHeader: true,
            cardLabel: null,
            tdClassName: "text-end",
            render: (item: ChecklistLibraryItemRow) => <DeleteItemButton templateId={templateId} itemId={item.id} />,
          } satisfies ResponsiveColumn<ChecklistLibraryItemRow>,
        ]
      : []),
  ];


  return (
    <div className="rounded-lg border border-border bg-surface">
      <ResponsiveTable
        columns={columns}
        rows={items}
        rowKey={(item) => item.id}
        caption="Checklist items"
        cardClassName="px-3"
        emptyCellClassName="px-3 py-8 text-center text-muted"
        empty={editable ? "No items yet — add one below or import from an Excel file." : "No items yet."}
      />
    </div>
  );
}
