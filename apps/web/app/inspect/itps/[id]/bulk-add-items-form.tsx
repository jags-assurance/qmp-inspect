"use client";

import { useActionState, useRef, useState, type FormEvent } from "react";
import { bulkAddItpItemsAction, type BulkAddItemsState } from "@/lib/itps/actions";

const initialState: BulkAddItemsState = { error: null };

/**
 * Add many activities to a section at once by pasting rows from Excel / Google Sheets
 * (Item no. | Activity | Acceptance criteria | Reference | Method | Frequency).
 */
export function BulkAddItemsForm({ itpId, sectionId, isIssued }: { itpId: string; sectionId: string; isIssued: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(bulkAddItpItemsAction, initialState);
  const reasonRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    if (isIssued) {
      const reason = prompt("This ITP has already been issued — reason for adding these activities (starts a new revision):");
      if (!reason || !reason.trim()) {
        e.preventDefault();
        return;
      }
      reasonRef.current!.value = reason.trim();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full border-t border-border bg-off-white px-4 py-2 text-left text-xs font-medium text-muted hover:text-burgundy"
      >
        + Paste many activities from a spreadsheet
      </button>
    );
  }

  const done = state.added && state.error === null;

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-2 border-t border-border bg-off-white px-4 py-4">
      <input type="hidden" name="itp_id" value={itpId} />
      <input type="hidden" name="section_id" value={sectionId} />
      <input type="hidden" name="revision_reason" ref={reasonRef} />
      <p className="text-xs text-muted">
        Paste rows copied from Excel or Google Sheets — one activity per line, columns:{" "}
        <strong>Item no. · Activity · Acceptance criteria · Reference/clause · Method · Frequency</strong>. Leave the item number blank to
        number automatically. Sign-off levels are set afterwards in the grid.
      </p>
      <textarea
        name="rows"
        rows={6}
        required
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"1.1\tVerify rebar size and spacing\tPer drawing S-101\tSpec 03200 cl.3\tVisual\t100%"}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-burgundy"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-burgundy px-3 py-1.5 text-sm font-medium text-white hover:bg-burgundy-dark disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add activities"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:underline">
          Close
        </button>
        {done && <span className="text-xs text-success">{state.added} activities added.</span>}
        {state.error && <span className="text-xs text-danger">{state.error}</span>}
      </div>
    </form>
  );
}
