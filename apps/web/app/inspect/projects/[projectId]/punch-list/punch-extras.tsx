"use client";

import { useActionState, useState } from "react";
import {
  bulkUpdatePunchItemsAction,
  withdrawPunchItemAction,
  type BulkPunchState,
  type WithdrawPunchState,
} from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const input = "rounded-md border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-burgundy";

/** Withdraw a manually raised item that was raised in error / is a duplicate. */
export function WithdrawPunchItemForm({ projectId, punchItemId }: { projectId: string; punchItemId: string }) {
  const tl = useTranslate();
  const [state, action, pending] = useActionState(withdrawPunchItemAction, { error: null } as WithdrawPunchState);
  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-medium text-muted hover:text-ink"><Tx>Withdraw (raised in error / duplicate)</Tx></summary>
      <form action={action} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="punch_item_id" value={punchItemId} />
        <textarea name="reason" rows={2} required minLength={5} placeholder={tl("Reason (required)")} className={input} />
        {state.error && <p role="alert" className="text-danger">{state.error}</p>}
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Withdrawing…" : "Withdraw item"}
        </Button>
      </form>
    </details>
  );
}

/** Verifiers: change responsible party / due date / priority of the selected items at once. */
export function BulkPunchBar({
  projectId,
  selectedIds,
  parties,
  onDone,
}: {
  projectId: string;
  selectedIds: string[];
  parties: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(bulkUpdatePunchItemsAction, { error: null } as BulkPunchState);
  const [done, setDone] = useState<BulkPunchState | null>(null);
  if (selectedIds.length === 0) return null;
  return (
    <form
      action={async (fd) => {
        action(fd);
        setDone(null);
        onDone();
      }}
      className="mb-3 flex flex-wrap items-end gap-3 rounded-md border border-border bg-off-white p-3 text-xs"
    >
      <input type="hidden" name="project_id" value={projectId} />
      {selectedIds.map((id) => (
        <input key={id} type="hidden" name="item_id" value={id} />
      ))}
      <span className="font-medium text-ink">{selectedIds.length} <Tx>selected</Tx></span>
      <label>
        <Tx>Responsible party</Tx>
        <select name="responsible_party_id" defaultValue="__keep" className={`mt-1 block ${input}`}>
          <option value="__keep"><Tx>Leave as is</Tx></option>
          <option value=""><Tx>Unassigned</Tx></option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <Tx>Due date</Tx>
        <input name="due_date" type="date" className={`mt-1 block ${input}`} />
      </label>
      <label>
        <Tx>Priority</Tx>
        <select name="priority" defaultValue="" className={`mt-1 block ${input}`}>
          <option value=""><Tx>Leave as is</Tx></option>
          <option value="A"><Tx>A - critical</Tx></option>
          <option value="B"><Tx>B - major</Tx></option>
          <option value="C"><Tx>C - minor</Tx></option>
        </select>
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Applying…" : "Apply to selected"}
      </Button>
      {state.error && <span className="text-danger">{state.error}</span>}
      {!state.error && state.updated != null && !pending && <span className="text-success">{state.updated} <Tx>item(s) updated.</Tx></span>}
      {done?.error && <span className="text-danger">{done.error}</span>}
    </form>
  );
}
