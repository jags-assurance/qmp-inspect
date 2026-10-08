"use client";

import { useActionState } from "react";
import { issueClearanceAction, type IssueClearanceState } from "@/lib/standalone/actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: IssueClearanceState = { error: null };

/** R16's close-out step: turns a "conditional_open" assignment into "completed" once its linked
 *  punch item(s) are actually closed. A clearance note is required so the close-out is a
 *  deliberate, recorded moment (who, when, why), not an automatic side-effect. */
export function IssueClearanceForm({ assignmentId, canClear }: { assignmentId: string; canClear: boolean }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(issueClearanceAction, initialState);

  const { gateSubmit, dialog } = useConfirm();
  const handleSubmit = gateSubmit({
    title: "Issue clearance?",
    message: "This marks the assignment as completed. This cannot be undone.",
    confirmLabel: "Issue clearance",
  });

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-border bg-surface p-4">
      {dialog}
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <div>
        <FormField label="Clearance note">
          <textarea
          name="clearance_notes"
          required
          minLength={5}
          maxLength={2000}
          rows={3}
          placeholder={tl("What was verified and how the punch items were closed out")}
          className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending || !canClear} title={!canClear ? "Close the linked punch item(s) first" : undefined}>
        {pending ? "Issuing…" : "Issue clearance"}
      </Button>
    </form>
  );
}
