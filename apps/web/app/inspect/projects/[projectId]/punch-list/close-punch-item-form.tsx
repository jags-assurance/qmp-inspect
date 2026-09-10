"use client";

import { useActionState, useState } from "react";
import { closePunchItemAction, type ClosePunchItemState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";

const initialState: ClosePunchItemState = { error: null };

/**
 * Per-row close action. Mirrors the NCR close-out gating pattern: the evidence field is required
 * and the requirement is enforced server-side in closePunchItemAction, not just by disabling this
 * button — the button state here is a convenience, the action is the real authority boundary.
 */
export function ClosePunchItemForm({ projectId, punchItemId }: { projectId: string; punchItemId: string }) {
  const [state, formAction, pending] = useActionState(closePunchItemAction, initialState);
  const [expanded, setExpanded] = useState(false);
  const [evidence, setEvidence] = useState("");

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-sm font-medium text-burgundy hover:underline"
      >
        Close
      </button>
    );
  }

  return (
    <form action={formAction} className="flex min-w-56 flex-col gap-2">
      <input type="hidden" name="punch_item_id" value={punchItemId} />
      <input type="hidden" name="project_id" value={projectId} />
      <textarea
        name="closing_evidence"
        required
        rows={2}
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        placeholder="Closing evidence (what was done, reference photo/record)…"
        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-burgundy"
      />
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !evidence.trim()}>
          {pending ? "Closing…" : "Confirm close"}
        </Button>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-off-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
