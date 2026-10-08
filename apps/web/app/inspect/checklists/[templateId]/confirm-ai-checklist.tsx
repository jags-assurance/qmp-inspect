"use client";

import { useActionState } from "react";
import { confirmAiChecklistAction, type ConfirmAiChecklistState } from "@/lib/checklists/ai-review-actions";
import { Button } from "@/components/ui/button";

const initialState: ConfirmAiChecklistState = { error: null };

export function ConfirmAiChecklist({ templateId, canConfirm }: { templateId: string; canConfirm: boolean }) {
  const [state, formAction, pending] = useActionState(confirmAiChecklistAction, initialState);
  return (
    <div className="mt-4 rounded-md border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-ink" role="status">
      <p className="font-medium">AI-generated draft - not yet confirmed</p>
      <p className="mt-1">
        These items were drafted by AI and have not been reviewed. Inspections cannot start from this checklist until JAGS staff
        review the items (edit them under &quot;Edit checklist template&quot; if needed) and confirm it.
      </p>
      {canConfirm ? (
        <form action={formAction} className="mt-3">
          <input type="hidden" name="template_id" value={templateId} />
          <Button type="submit" disabled={pending}>
            {pending ? "Confirming…" : "Confirm AI-generated checklist"}
          </Button>
        </form>
      ) : (
        <p className="mt-2 text-muted">Waiting for JAGS staff to confirm it.</p>
      )}
      {state.error && (
        <p className="mt-2 text-danger" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
