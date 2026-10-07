"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  deleteChecklistItemAction,
  reorderChecklistItemsAction,
  updateChecklistItemAction,
} from "@/lib/checklists/template-item-actions";
import { moveItem } from "@/lib/checklists/template-logic";

export interface EditorItem {
  id: string;
  item_number: string;
  description: string;
  is_mandatory: boolean;
}

/**
 * Per-item edit / delete / reorder controls for the checklist template. When `blockedReason` is set
 * (template frozen by responses, or archived) every control is disabled and the reason is shown
 * once above the list (and linked via aria-describedby from each control).
 */
export function TemplateItemsEditor({
  templateId,
  items,
  blockedReason,
}: {
  templateId: string;
  items: EditorItem[];
  blockedReason: string | null;
}) {
  const router = useRouter();
  const { ask, dialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const reasonId = useId();
  const disabled = blockedReason !== null || pending;
  const describedBy = blockedReason ? reasonId : undefined;

  function run(fn: () => Promise<{ error: string | null }>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        onOk?.();
        router.refresh();
      }
    });
  }

  function move(id: string, direction: "up" | "down") {
    const orderedItemIds = moveItem(
      items.map((i) => i.id),
      id,
      direction
    );
    run(() => reorderChecklistItemsAction({ templateId, orderedItemIds }));
  }

  async function remove(item: EditorItem) {
    const ok = await ask({
      title: `Delete item ${item.item_number}?`,
      message: <>This permanently removes &quot;{item.description}&quot; from the checklist. It cannot be undone.</>,
      confirmLabel: "Delete item",
      destructive: true,
    });
    if (ok === null) return;
    run(() => deleteChecklistItemAction({ templateId, itemId: item.id }));
  }

  return (
    <div>
      {dialog}
      {blockedReason && (
        <p id={reasonId} className="border-b border-border bg-warning/10 px-4 py-2 text-xs text-ink" role="note">
          Editing is disabled: {blockedReason}
        </p>
      )}
      <ul className="divide-y divide-border">
        {items.map((item, idx) =>
          editingId === item.id ? (
            <li key={item.id} className="px-4 py-3">
              <EditItemForm
                item={item}
                pending={pending}
                onCancel={() => setEditingId(null)}
                onSave={(v) =>
                  run(
                    () => updateChecklistItemAction({ templateId, itemId: item.id, ...v }),
                    () => setEditingId(null)
                  )
                }
              />
            </li>
          ) : (
            <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm text-ink">
              <span className="doc-id text-muted">{item.item_number}.</span>
              <span className="min-w-40 flex-1">{item.description}</span>
              <span title="Only changes the red asterisk shown to the inspector — every item must still be answered.">
                <Badge tone={item.is_mandatory ? "danger" : "neutral"}>{item.is_mandatory ? "Mandatory" : "Optional"}</Badge>
              </span>
              <span className="flex items-center gap-1" role="group" aria-label={`Actions for item ${item.item_number}`}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || idx === 0}
                  aria-describedby={describedBy}
                  aria-label={`Move item ${item.item_number} up`}
                  onClick={() => move(item.id, "up")}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || idx === items.length - 1}
                  aria-describedby={describedBy}
                  aria-label={`Move item ${item.item_number} down`}
                  onClick={() => move(item.id, "down")}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  aria-describedby={describedBy}
                  aria-label={`Edit item ${item.item_number}`}
                  onClick={() => setEditingId(item.id)}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  aria-describedby={describedBy}
                  aria-label={`Delete item ${item.item_number}`}
                  className="text-danger"
                  onClick={() => void remove(item)}
                >
                  Delete
                </Button>
              </span>
            </li>
          )
        )}
        {items.length === 0 && <li className="px-4 py-4 text-sm text-muted">No items yet.</li>}
      </ul>
      <div role="alert" className="px-4">
        {error && <p className="py-2 text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}

function EditItemForm({
  item,
  pending,
  onSave,
  onCancel,
}: {
  item: EditorItem;
  pending: boolean;
  onSave: (v: { itemNumber: string; description: string; isMandatory: boolean }) => void;
  onCancel: () => void;
}) {
  const id = useId();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSave({
          itemNumber: String(f.get("item_number") ?? ""),
          description: String(f.get("description") ?? ""),
          isMandatory: f.get("is_mandatory") === "on",
        });
      }}
    >
      <div>
        <label htmlFor={`${id}-n`} className="block text-xs font-medium text-muted">
          Item no.
        </label>
        <input
          id={`${id}-n`}
          name="item_number"
          required
          maxLength={20}
          defaultValue={item.item_number}
          className="mt-1 w-20 rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div className="min-w-64 flex-1">
        <label htmlFor={`${id}-d`} className="block text-xs font-medium text-muted">
          Description
        </label>
        <input
          id={`${id}-d`}
          name="description"
          required
          maxLength={500}
          defaultValue={item.description}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm text-ink">
        <input type="checkbox" name="is_mandatory" defaultChecked={item.is_mandatory} />
        Mandatory
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={pending}>
        Cancel
      </Button>
    </form>
  );
}
