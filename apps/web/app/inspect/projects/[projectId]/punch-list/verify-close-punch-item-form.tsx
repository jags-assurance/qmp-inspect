"use client";

import { useActionState, useState } from "react";
import { closePunchItemAction, type ClosePunchItemState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: ClosePunchItemState = { error: null };

/**
 * Step 2 of 2 — only rendered for a viewer the page has already determined can verify/close (JAGS
 * Admin, or a close_punch_item permission holder — see closePunchItemAction's own doc comment for
 * why). The server action re-checks this itself regardless; this component just avoids showing a
 * control to someone who'd only find out it's blocked after submitting.
 */
export function VerifyClosePunchItemForm({ projectId, punchItemId }: { projectId: string; punchItemId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(closePunchItemAction, initialState);
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState("");

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-sm font-medium text-burgundy hover:underline"
      >
        <Tx>Verify &amp; close</Tx>
      </button>
    );
  }

  return (
    <form action={formAction} className="flex w-full sm:min-w-56 flex-col gap-2">
      <input type="hidden" name="punch_item_id" value={punchItemId} />
      <input type="hidden" name="project_id" value={projectId} />
      <textarea
        name="verification_notes"
        required
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={tl("Verification notes (what you checked to confirm the fix)…")}
        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-burgundy"
      />
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !notes.trim()}>
          {pending ? "Closing…" : "Confirm close"}
        </Button>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-off-white"
        >
          <Tx>Cancel</Tx>
        </button>
      </div>
    </form>
  );
}
