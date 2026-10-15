"use client";

import { useActionState, useState } from "react";
import { closePunchItemAction, type ClosePunchItemState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: ClosePunchItemState = { error: null };

/**
 * Step 2 of 2 — only rendered for a viewer the page has already determined can verify/close (JAGS
 * Admin, or a close_punch_item permission holder — see closePunchItemAction's own doc comment for
 * why). The server action re-checks this itself regardless; this component just avoids showing a
 * control to someone who'd only find out it's blocked after submitting.
 */
export function VerifyClosePunchItemForm({ projectId, punchItemId, isAdmin = false }: { projectId: string; punchItemId: string; isAdmin?: boolean }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(closePunchItemAction, initialState);
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState("");
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");

  if (!expanded) {
    return (
      <Button
        type="button"
        onClick={() => setExpanded(true)}
        variant="link"
      >
        <Tx>Verify &amp; close</Tx>
      </Button>
    );
  }

  return (
    <form action={formAction} className="grid gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5 md:grid-cols-2">
      <input type="hidden" name="punch_item_id" value={punchItemId} />
      <input type="hidden" name="project_id" value={projectId} />
      <textarea
        name="verification_notes"
        required
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={tl("Verification notes (what you checked to confirm the fix)…")}
        className="w-full md:col-span-2 rounded-md border border-control-border bg-surface px-3 py-2 text-sm min-h-11"
      />
      {isAdmin && (
        <label className="flex min-h-11 items-center gap-2 text-sm text-muted md:col-span-2">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          <Tx>Close as admin (reason) - for an item you resolved yourself</Tx>
        </label>
      )}
      {isAdmin && override && (
        <textarea
          name="override_reason"
          required
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={tl("Override reason (min 10 characters, audited)…")}
          className="w-full md:col-span-2 rounded-md border border-control-border bg-surface px-3 py-2 text-sm min-h-11"
        />
      )}
      {state.error && <p role="alert" className="text-sm text-danger md:col-span-2">{state.error}</p>}
      <StickyActionBar inCard className="md:col-span-2">
        <Button type="submit" disabled={pending || !notes.trim() || (override && reason.trim().length < 10)}>
          {pending ? "Closing…" : "Confirm close"}
        </Button>
        <Button
          type="button"
          onClick={() => setExpanded(false)}
          variant="outline"
        >
          <Tx>Cancel</Tx>
        </Button>
      </StickyActionBar>
    </form>
  );
}
