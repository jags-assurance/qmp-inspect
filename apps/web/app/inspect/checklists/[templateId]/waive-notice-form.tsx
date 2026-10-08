"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { waiveWitnessNoticeAction, type WaiveNoticeState } from "@/lib/checklists/waiver-actions";
import { WAIVER_REASON_MIN } from "@/lib/checklists/notice-waiver";
import { Button } from "@/components/ui/button";

const initial: WaiveNoticeState = { error: null };

/** Staff only: shown when a Witness party was never notified and is blocking completion. */
export function WaiveNoticeForm({ inspectionRecordId, labels }: { inspectionRecordId: string; labels: string[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(async (prev: WaiveNoticeState, formData: FormData) => {
    const next = await waiveWitnessNoticeAction(prev, formData);
    if (next.done) router.refresh();
    return next;
  }, initial);

  return (
    <form action={formAction} className="rounded-md border border-warning/60 bg-warning/10 p-3 text-sm">
      <p className="font-medium text-ink">The {labels.join(", ")} party has not been notified.</p>
      <p className="mt-1 text-xs text-muted">
        Notify them from the Sign-off tab on the ITP, or record a written waiver so this one inspection can be completed.
      </p>
      <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
      <label htmlFor="waiver-reason" className="mt-2 block text-xs font-medium text-ink">
        Reason for waiving the notice (kept on the audit trail)
      </label>
      <textarea
        id="waiver-reason"
        name="reason"
        required
        minLength={WAIVER_REASON_MIN}
        rows={2}
        className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm"
        aria-describedby={state.error ? "waiver-error" : undefined}
      />
      {state.error && (
        <p id="waiver-error" role="alert" className="mt-1 text-xs text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={pending} className="mt-2">
        {pending ? "Recording…" : "Waive notice for this inspection"}
      </Button>
    </form>
  );
}
