"use client";

import { useActionState, useState } from "react";
import { requestCorrectionAction, resolveCorrectionRequestAction, type CorrectionRequestState } from "@/lib/checklists/correction-request-actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Disclosure } from "@/components/ui/disclosure";
import { formatDateTime } from "@/lib/dates/format";

const initialState: CorrectionRequestState = { error: null };

/** For someone who can execute the activity but cannot re-open it: asks staff for a correction. */
export function RequestCorrectionForm({ inspectionRecordId }: { inspectionRecordId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(requestCorrectionAction, initialState);
  return (
    <Disclosure variant="inline" summary={<><Tx>Request correction…</Tx></>} className="text-sm">
      <form action={formAction} className="mt-2 space-y-2">
        <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
        <p className="text-xs text-muted">
          <Tx>Ask a JAGS admin or team lead to re-open this inspection so it can be corrected. They are notified and will approve or decline.</Tx>
        </p>
        <textarea aria-label={tl("What needs correcting and why (min 10 characters)")}
          name="reason"
          required
          minLength={10}
          maxLength={1000}
          rows={2}
          placeholder={tl("What needs correcting and why (min 10 characters)")}
          className="w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send request"}</Button>
        {state.ok && <p className="text-sm text-success"><Tx>Request sent. Staff have been notified.</Tx></p>}
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </form>
</Disclosure>
  );
}

export interface CorrectionRequestView {
  id: string;
  reason: string;
  status: "open" | "approved" | "declined";
  requesterName: string;
  createdAt: string;
  resolutionNote: string | null;
}

function ResolveForm({ requestId }: { requestId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(resolveCorrectionRequestAction, initialState);
  const [declining, setDeclining] = useState(false);
  return (
    <form action={formAction} className="mt-2 space-y-2">
      <input type="hidden" name="request_id" value={requestId} />
      {declining && (
        <textarea aria-label={tl("Why is this declined? (required)")}
          name="note"
          required
          minLength={5}
          maxLength={1000}
          rows={2}
          placeholder={tl("Why is this declined? (required)")}
          className="w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-xs outline-none focus:border-burgundy"
        />
      )}
      <div className="flex gap-2">
        {!declining && (
          <Button type="submit" name="decision" value="approve" size="sm" disabled={pending}>
            {pending ? "Working…" : "Approve and re-open"}
          </Button>
        )}
        {declining ? (
          <Button type="submit" name="decision" value="decline" size="sm" disabled={pending}>{pending ? "Working…" : "Confirm decline"}</Button>
        ) : (
          <Button type="button" onClick={() => setDeclining(true)} variant="outline" size="sm">
            <Tx>Decline…</Tx>
          </Button>
        )}
      </div>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}

/** Staff list: open requests with approve / decline, resolved ones as history. */
export function CorrectionRequestsPanel({ requests, canResolve }: { requests: CorrectionRequestView[]; canResolve: boolean }) {
  const open = requests.filter((r) => r.status === "open");
  if (requests.length === 0) return null;
  return (
    <div className="mt-6 rounded-lg border border-border bg-surface p-4 text-sm">
      <h2 className="text-sm font-medium text-ink"><Tx>Correction requests</Tx> ({open.length})</h2>
      <ul className="mt-2 divide-y divide-border">
        {requests.map((r) => (
          <li key={r.id} className="py-2">
            <p className="text-ink">{r.reason}</p>
            <p className="text-xs text-muted">
              {r.requesterName}, {formatDateTime(r.createdAt)} - {r.status}
              {r.resolutionNote ? `: ${r.resolutionNote}` : ""}
            </p>
            {r.status === "open" && canResolve && <ResolveForm requestId={r.id} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
