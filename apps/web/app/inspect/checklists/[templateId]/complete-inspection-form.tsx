"use client";

import { useActionState, useState } from "react";
import { completeInspectionAction, type CompleteInspectionState } from "@/lib/checklists/actions";
import { SignaturePad } from "@/components/domain/signature-pad";
import { Button } from "@/components/ui/button";
import { enqueueOutboxItem } from "@/lib/offline/db";
import { notifyOutboxChanged } from "@/lib/offline/sync-client";

const initialState: CompleteInspectionState = { error: null };

export function CompleteInspectionForm({
  templateId,
  inspectionRecordId,
}: {
  templateId: string;
  inspectionRecordId: string;
}) {
  const [state, formAction, pending] = useActionState(completeInspectionAction, initialState);
  const [signature, setSignature] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Offline (R60): completeInspectionAction always redirects on success, which needs a live
  // navigation — it can't be the fallback path. Instead, queue the same fields the action expects
  // and let the offline-sync route (which calls completeInspectionCore, the redirect-free half of
  // the same logic) replay it once back online.
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (typeof navigator === "undefined" || navigator.onLine) return;
    e.preventDefault();
    setQueueError(null);
    const formData = new FormData(e.currentTarget);
    try {
      await enqueueOutboxItem({
        kind: "complete_inspection",
        fields: Object.fromEntries(formData) as Record<string, string>,
      });
      notifyOutboxChanged();
      setQueued(true);
    } catch {
      setQueueError("Could not queue the completion for later sync.");
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="rounded-lg border border-border bg-surface p-6">
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
      <input type="hidden" name="signature" value={signature ?? ""} />

      <h2 className="text-base font-medium text-ink">
        Inspector sign-off <span className="text-danger">*</span>
      </h2>

      <div className="mt-3">
        <SignaturePad onChange={setSignature} />
      </div>
      {!signature && (
        <p className="mt-1 text-xs text-muted">Sign above — a signature is required to complete the inspection.</p>
      )}

      <label htmlFor="notes" className="mt-4 block text-sm font-medium text-ink">
        Notes (optional)
      </label>
      <textarea
        id="notes"
        name="notes"
        rows={3}
        disabled={queued}
        className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
      />

      <Button type="submit" disabled={pending || !signature || queued} className="mt-4">
        {queued ? "Queued — will complete when back online" : pending ? "Completing…" : "Complete inspection"}
      </Button>
      {queued && (
        <p className="mt-2 text-sm text-warning">
          You&apos;re offline. This inspection will be completed automatically once your connection is back.
        </p>
      )}
      {state.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
      {queueError && <p className="mt-2 text-sm text-danger">{queueError}</p>}
    </form>
  );
}
