"use client";

import { useActionState, useState } from "react";
import { withdrawDataBookAction, type WithdrawDataBookState } from "@/lib/databook/actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";

const initialState: WithdrawDataBookState = { error: null };

/** Admin-only: returns a COMPILED book to draft (wrong override reason / number / data changed). */
export function WithdrawDataBookForm({ projectId, dataBookId }: { projectId: string; dataBookId: string }) {
  const [state, formAction, pending] = useActionState(withdrawDataBookAction, initialState);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-burgundy hover:underline">
        <Tx>Withdraw to draft…</Tx>
      </button>
    );
  }
  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2 rounded-md border border-border p-2">
      <input type="hidden" name="data_book_id" value={dataBookId} />
      <input type="hidden" name="project_id" value={projectId} />
      <label htmlFor={`withdraw_reason_${dataBookId}`} className="text-xs font-medium text-ink">
        <Tx>Why is the compiled book being withdrawn?</Tx>
      </label>
      <textarea
        id={`withdraw_reason_${dataBookId}`}
        name="reason"
        required
        minLength={10}
        maxLength={2000}
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-burgundy"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={pending || reason.trim().length < 10}>
          {pending ? "Withdrawing…" : "Withdraw to draft"}
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:underline">
          <Tx>Cancel</Tx>
        </button>
      </div>
      {state.error && <p className="text-xs text-danger" role="alert">{state.error}</p>}
    </form>
  );
}
