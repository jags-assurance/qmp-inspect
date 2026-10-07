"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { updateNcrAction, reopenNcrAction, suggestNcrRootCauseAction, type ReopenNcrState, type UpdateNcrState, type SuggestRootCauseState } from "@/lib/ncrs/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const initialState: UpdateNcrState = { error: null };
const suggestInitialState: SuggestRootCauseState = { error: null, rootCause: null, aiLogId: null };

export function CloseOutForm({
  ncrId,
  assignedTo,
  people,
  responsiblePartyId,
  parties,
  dueDate,
  rootCause,
  correctiveAction,
  preventiveAction,
  verificationNotes,
  isClosed,
  status,
  canVerify,
  photoCount,
  onSaved,
}: {
  ncrId: string;
  assignedTo: string | null;
  people: { id: string; name: string }[];
  /** R68: the NCR's currently-set vendor/party FK, if any, and the project's active parties to
   *  choose from — optional, editable up to closure. */
  responsiblePartyId: string | null;
  parties: { id: string; name: string; party_type: string }[];
  dueDate: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  preventiveAction: string | null;
  verificationNotes: string | null;
  isClosed: boolean;
  status: string;
  /** JAGS staff may verify/close/reopen. */
  canVerify: boolean;
  photoCount: number;
  /** Called after a successful save (used by the register side panel to refetch). */
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateNcrAction, initialState);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });
  useEffect(() => {
    if (state !== initialState && !state.error) onSavedRef.current?.();
  }, [state]);
  const [suggestState, suggestFormAction, suggestPending] = useActionState(suggestNcrRootCauseAction, suggestInitialState);
  const [fields, setFields] = useState({
    rootCause: rootCause ?? "",
    correctiveAction: correctiveAction ?? "",
    verificationNotes: verificationNotes ?? "",
  });

  const [aiLogId, setAiLogId] = useState<string | null>(null);
  const [aiOriginalRootCause, setAiOriginalRootCause] = useState<string | null>(null);

  const [appliedSuggestState, setAppliedSuggestState] = useState(suggestState);
  if (suggestState !== appliedSuggestState) {
    setAppliedSuggestState(suggestState);
    if (suggestState.rootCause !== null) {
      setFields((f) => ({ ...f, rootCause: suggestState.rootCause! }));
      setAiLogId(suggestState.aiLogId);
      setAiOriginalRootCause(suggestState.rootCause);
    }
  }

  const [fields2, setFields2] = useState({ preventive: preventiveAction ?? "" });
  const [reopenState, reopenAction, reopenPending] = useActionState(reopenNcrAction, { error: null } as ReopenNcrState);
  const capaComplete = Boolean(fields.rootCause.trim() && fields.correctiveAction.trim() && fields2.preventive.trim() && fields.verificationNotes.trim());
  const canClose = capaComplete && photoCount > 0 && status === "pending_verification" && canVerify;

  return (
    <div>
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="ncr_id" value={ncrId} />
      <input type="hidden" name="root_cause_ai_log_id" value={aiLogId ?? ""} />
      <input type="hidden" name="root_cause_ai_original" value={aiOriginalRootCause ?? ""} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="assigned_to" className="block text-sm font-medium text-ink">
            Assigned to
          </label>
          <select
            id="assigned_to"
            name="assigned_to"
            defaultValue={assignedTo ?? ""}
            disabled={isClosed}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
          >
            <option value="">Unassigned</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="due_date" className="block text-sm font-medium text-ink">
            Due date
          </label>
          <input
            id="due_date"
            name="due_date"
            type="date"
            required
            defaultValue={dueDate ?? ""}
            disabled={isClosed}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
          />
        </div>
      </div>

      <div>
        <label htmlFor="responsible_party_id" className="block text-sm font-medium text-ink">
          Responsible party <span className="font-normal text-muted">(optional)</span>
        </label>
        <select
          id="responsible_party_id"
          name="responsible_party_id"
          defaultValue={responsiblePartyId ?? ""}
          disabled={isClosed}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        >
          <option value="">Not specified</option>
          {parties.map((party) => (
            <option key={party.id} value={party.id}>
              {party.name} ({party.party_type})
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="root_cause" className="block text-sm font-medium text-ink">
            Root cause
          </label>
          {!isClosed && (
            <button
              type="button"
              onClick={() => {
                const fd = new FormData();
                fd.set("ncr_id", ncrId);
                suggestFormAction(fd);
              }}
              disabled={suggestPending}
              className="text-xs font-medium text-burgundy hover:underline disabled:opacity-50"
            >
              {suggestPending ? "Suggesting…" : "Suggest with AI"}
            </button>
          )}
        </div>
        <textarea
          id="root_cause"
          name="root_cause"
          rows={3}
          value={fields.rootCause}
          disabled={isClosed}
          onChange={(e) => setFields((f) => ({ ...f, rootCause: e.target.value }))}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        />
        {suggestState.error && <p className="mt-1 text-xs text-danger">{suggestState.error}</p>}
        {aiOriginalRootCause !== null && (
          <p className="mt-1">
            <Badge tone="info">AI-assisted draft</Badge>
          </p>
        )}
      </div>

      <div>
        <label htmlFor="corrective_action" className="block text-sm font-medium text-ink">
          Corrective action
        </label>
        <textarea
          id="corrective_action"
          name="corrective_action"
          rows={3}
          defaultValue={correctiveAction ?? ""}
          disabled={isClosed}
          onChange={(e) => setFields((f) => ({ ...f, correctiveAction: e.target.value }))}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        />
      </div>

      <div>
        <label htmlFor="preventive_action" className="block text-sm font-medium text-ink">
          Preventive action
        </label>
        <textarea
          id="preventive_action"
          name="preventive_action"
          rows={3}
          defaultValue={preventiveAction ?? ""}
          onChange={(e) => setFields2({ preventive: e.target.value })}
          disabled={isClosed}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        />
      </div>

      <div>
        <label htmlFor="verification_notes" className="block text-sm font-medium text-ink">
          Verification of effectiveness
        </label>
        <textarea
          id="verification_notes"
          name="verification_notes"
          rows={3}
          defaultValue={verificationNotes ?? ""}
          disabled={isClosed}
          onChange={(e) => setFields((f) => ({ ...f, verificationNotes: e.target.value }))}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        />
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      {!isClosed && (
        <div className="flex gap-3">
          <Button type="submit" name="close_now" value="false" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Save progress"}
          </Button>
          {canVerify && (
            <Button type="submit" name="close_now" value="true" disabled={pending || !canClose}>
              {pending ? "Closing…" : "Verify and close NCR"}
            </Button>
          )}
        </div>
      )}
      {!isClosed && canVerify && !canClose && (
        <p className="text-xs text-muted">
          To close: status must be Pending verification, with root cause, corrective action, preventive action,
          verification notes and at least one evidence photo.
          {photoCount === 0 ? " No evidence photo yet." : ""}
        </p>
      )}
      {!isClosed && !canVerify && (
        <p className="text-xs text-muted">Closing is done by a JAGS verifier after you send the NCR for verification.</p>
      )}
    </form>
    {isClosed && canVerify && (
      <form action={reopenAction} className="mt-4 space-y-2 border-t border-border pt-4">
        <input type="hidden" name="ncr_id" value={ncrId} />
        <label htmlFor="reopen_reason" className="block text-sm font-medium text-ink">Re-open this NCR</label>
        <textarea id="reopen_reason" name="reason" rows={2} required placeholder="Reason for re-opening (required)" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy" />
        {reopenState.error && <p className="text-sm text-danger">{reopenState.error}</p>}
        <Button type="submit" variant="outline" disabled={reopenPending}>{reopenPending ? "Re-opening…" : "Re-open NCR"}</Button>
      </form>
    )}
    </div>
  );
}
