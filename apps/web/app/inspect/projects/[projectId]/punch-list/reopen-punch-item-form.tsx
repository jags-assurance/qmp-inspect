"use client";

import { useActionState, useState } from "react";
import { reopenPunchItemAction, type ReopenPunchItemState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: ReopenPunchItemState = { error: null };

/** Reject a fix (resolved -> open) or reopen a closed item; a reason is mandatory. */
export function ReopenPunchItemForm({
  projectId,
  punchItemId,
  label = "Reopen",
}: {
  projectId: string;
  punchItemId: string;
  label?: string;
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(reopenPunchItemAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");

  if (!expanded) {
    return (
      <Button
        type="button"
        onClick={() => setExpanded(true)}
        variant="link-danger"
      >
        {label}
      </Button>
    );
  }

  return (
    <form onSubmit={keepValuesSubmit} className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5 md:grid-cols-2">
      <input type="hidden" name="punch_item_id" value={punchItemId} />
      <input type="hidden" name="project_id" value={projectId} />
      <textarea
        name="reason"
        required
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={tl("Why is this being reopened?")}
        className="w-full md:col-span-2 rounded-md border border-control-border bg-surface px-3 py-2 text-sm min-h-11"
      />
      {state.error && <p role="alert" className="text-sm text-danger md:col-span-2">{state.error}</p>}
      <StickyActionBar inCard className="md:col-span-2">
        <Button type="submit" disabled={pending || !reason.trim()}>
          {pending ? "Reopening…" : "Confirm reopen"}
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
