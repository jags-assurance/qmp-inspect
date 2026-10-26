"use client";

import { useRestoreOnError } from "@/lib/hooks/use-keep-form-values";
import { useActionState, useState } from "react";
import { bulkAddItpItemsAction, type BulkAddItemsState } from "@/lib/itps/actions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";

const initialState: BulkAddItemsState = { error: null };

/**
 * Add many activities to a section at once by pasting rows from Excel / Google Sheets
 * (Item no. | Activity | Acceptance criteria | Reference | Method | Frequency).
 */
export function BulkAddItemsForm({ itpId, sectionId, isIssued }: { itpId: string; sectionId: string; isIssued: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(bulkAddItpItemsAction, initialState);
  const captureForm = useRestoreOnError(state);
  const { gateSubmit, dialog } = useConfirm();
  const [text, setText] = useState("");

  const handleSubmit = gateSubmit(
    isIssued
      ? {
          title: "Add activities to an issued ITP",
          message: "This ITP has already been issued. Adding these activities will start a new revision.",
          confirmLabel: "Add activities",
          reason: { label: "Reason for adding these activities", required: true },
        }
      : null,
    "revision_reason"
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full border-t border-border bg-off-white px-4 py-2 text-start text-xs font-medium text-muted hover:text-burgundy [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:text-sm"
      >
        <Tx>+ Paste many activities from a spreadsheet</Tx>
      </button>
    );
  }

  const done = state.added && state.error === null;

  return (
    <form action={formAction} onSubmit={(e) => {
        captureForm(e.currentTarget);
        handleSubmit(e);
      }} className="space-y-2 border-t border-border bg-off-white px-4 py-4">
      <input type="hidden" name="itp_id" value={itpId} />
      <input type="hidden" name="section_id" value={sectionId} />
      {dialog}
      <input type="hidden" name="revision_reason" />
      <p className="text-xs text-muted">
        <Tx>Paste rows copied from Excel or Google Sheets — one activity per line, columns:</Tx>{" "}
        <strong><Tx>Item no. · Activity · Acceptance criteria · Reference/clause · Method · Frequency</Tx></strong><Tx>. Leave the item number blank to number automatically. Sign-off levels are set afterwards in the grid.</Tx>
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
        <Button
          type="submit"
          disabled={pending}
          size="sm"
        >
          {pending ? "Adding…" : "Add activities"}
        </Button>
        <Button type="button" onClick={() => setOpen(false)} variant="link-muted" size="sm">
          <Tx>Close</Tx>
        </Button>
        {done && <span className="text-xs text-success">{state.added} <Tx>activities added.</Tx></span>}
        {state.error && <span className="text-xs text-danger">{state.error}</span>}
      </div>
    </form>
  );
}
