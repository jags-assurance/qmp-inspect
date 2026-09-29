"use client";

import { useActionState } from "react";
import { recordExternalApprovalAction, type RecordExternalApprovalState } from "@/lib/itps/actions";

const initialState: RecordExternalApprovalState = { error: null };

/**
 * R80: lets staff record that the client approved this ITP in their OWN external system (e.g.
 * "Approved in client's Aconex system, ref AX-2026-4471") instead of clicking Accept in this app.
 * Not editable inline once set — re-submitting the form overwrites the reference/recorded-by/
 * recorded-at, which is enough to correct a mistake without a separate edit-lock flow.
 */
export function ExternalApprovalForm({
  itpId,
  reference,
  recordedByName,
  recordedAt,
}: {
  itpId: string;
  reference: string | null;
  recordedByName: string | null;
  recordedAt: string | null;
}) {
  const [state, formAction, pending] = useActionState(recordExternalApprovalAction, initialState);

  return (
    <div className="mt-8 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">External approval reference</h2>
      <p className="mt-1 text-xs text-muted">
        Record a reference if the client approved this ITP in their own document-control system
        instead of accepting it here.
      </p>

      {reference && (
        <div className="mt-3 rounded-md border border-border bg-off-white/60 p-3 text-sm">
          <p className="text-ink">{reference}</p>
          {(recordedByName || recordedAt) && (
            <p className="mt-1 text-xs text-muted">
              Recorded by {recordedByName ?? "unknown"}
              {recordedAt ? ` on ${new Date(recordedAt).toLocaleString("en-GB")}` : ""}
            </p>
          )}
        </div>
      )}

      <form action={formAction} className="mt-3 flex flex-wrap items-start gap-2">
        <input type="hidden" name="itp_id" value={itpId} />
        <input
          type="text"
          name="reference"
          placeholder="e.g. Approved in client's Aconex system, ref AX-2026-4471"
          defaultValue={reference ?? ""}
          required
          className="min-w-[20rem] flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white disabled:opacity-50"
        >
          {pending ? "Saving…" : reference ? "Update reference" : "Record reference"}
        </button>
      </form>
      {state.error && <p className="mt-1 text-xs text-danger">{state.error}</p>}
    </div>
  );
}
