"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { updateNcrAction, reopenNcrAction, suggestNcrRootCauseAction, type ReopenNcrState, type UpdateNcrState, type SuggestRootCauseState } from "@/lib/ncrs/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReturnForReworkForm } from "./ncr-status-controls";
import { NCR_DISPOSITIONS, NCR_DISPOSITION_LABELS } from "@/lib/ncrs/extended";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

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
  canClose,
  canAssign,
  capaLocked,
  photoCount,
  onSaved,
  categories,
  rootCauseCategory,
  disposition,
  costImpact,
  scheduleImpactDays,
  contractorResponse,
  selfVerifyConflict = false,
  isAdmin = false,
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
  /** Admin staff or close_ncr holder: may verify/close/re-open. */
  canClose: boolean;
  /** Staff or raiser: may change assignee, due date and party. */
  canAssign: boolean;
  /** CAPA text locked for this viewer (pending verification, non-staff). */
  capaLocked: boolean;
  /** Evidence items: photos plus linked documents. */
  photoCount: number;
  /** Called after a successful save (used by the register side panel to refetch). */
  onSaved?: () => void;
  /** Root-cause taxonomy; when omitted the classification fields are not shown. */
  categories?: { code: string; label: string }[];
  rootCauseCategory?: string | null;
  disposition?: string | null;
  costImpact?: number | null;
  scheduleImpactDays?: number | null;
  contractorResponse?: string | null;
  /** The viewer is the assignee / CAPA author: an admin closing needs a written override reason. */
  selfVerifyConflict?: boolean;
  isAdmin?: boolean;
}) {
  const tl = useTranslate();
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
  const canCloseNow = capaComplete && photoCount > 0 && status === "pending_verification" && canClose;

  return (
    <div>
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="ncr_id" value={ncrId} />
      <input type="hidden" name="root_cause_ai_log_id" value={aiLogId ?? ""} />
      <input type="hidden" name="root_cause_ai_original" value={aiOriginalRootCause ?? ""} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FormField label="Assigned to">
            <select
            name="assigned_to"
            defaultValue={assignedTo ?? ""}
            disabled={isClosed || !canAssign}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
          >
            <option value=""><Tx>Unassigned</Tx></option>
            {/* Logins that cannot reassign only need to see the current assignee, not the whole user list. */}
            {(canAssign ? people : people.filter((person) => person.id === assignedTo)).map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          </FormField>
        </div>
        <div>
          <FormField label="Due date">
            <input
            name="due_date"
            type="date"
            required
            defaultValue={dueDate ?? ""}
            disabled={isClosed || !canAssign}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
          />
          </FormField>
        </div>
      </div>

      <div>
        <label htmlFor="responsible_party_id" className="block text-sm font-medium text-ink">
          <Tx>Responsible party</Tx> <span className="font-normal text-muted"><Tx>(optional)</Tx></span>
        </label>
        <select
          id="responsible_party_id"
          name="responsible_party_id"
          defaultValue={responsiblePartyId ?? ""}
          disabled={isClosed || !canAssign}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        >
          <option value=""><Tx>Not specified</Tx></option>
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
            <Tx>Root cause</Tx>
          </label>
          {!isClosed && !capaLocked && (
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
          disabled={isClosed || capaLocked}
          onChange={(e) => setFields((f) => ({ ...f, rootCause: e.target.value }))}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        />
        {suggestState.error && <p role="alert" className="mt-1 text-xs text-danger">{suggestState.error}</p>}
        {aiOriginalRootCause !== null && (
          <p className="mt-1">
            <Badge tone="info"><Tx>AI-assisted draft</Tx></Badge>
          </p>
        )}
      </div>

      <div>
        <FormField label="Corrective action">
          <textarea
          name="corrective_action"
          rows={3}
          defaultValue={correctiveAction ?? ""}
          disabled={isClosed || capaLocked}
          onChange={(e) => setFields((f) => ({ ...f, correctiveAction: e.target.value }))}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        />
        </FormField>
      </div>

      <div>
        <FormField label="Preventive action">
          <textarea
          name="preventive_action"
          rows={3}
          defaultValue={preventiveAction ?? ""}
          onChange={(e) => setFields2({ preventive: e.target.value })}
          disabled={isClosed || capaLocked}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        />
        </FormField>
      </div>

      <div>
        <FormField label="Verification of effectiveness">
          <textarea
          name="verification_notes"
          rows={3}
          defaultValue={verificationNotes ?? ""}
          disabled={isClosed || capaLocked}
          onChange={(e) => setFields((f) => ({ ...f, verificationNotes: e.target.value }))}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        />
        </FormField>
      </div>

      {categories && (
        <fieldset className="space-y-4 rounded-md border border-border p-3" disabled={isClosed || capaLocked}>
          <legend className="px-1 text-xs font-medium text-muted"><Tx>Classification</Tx></legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FormField label="Root-cause category">
                <select name="root_cause_category" defaultValue={rootCauseCategory ?? ""} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60">
                <option value=""><Tx>Not classified</Tx></option>
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
              </FormField>
            </div>
            <div>
              <FormField label="Disposition">
                <select name="disposition" defaultValue={disposition ?? ""} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60">
                <option value=""><Tx>Not decided</Tx></option>
                {NCR_DISPOSITIONS.map((d) => (
                  <option key={d} value={d}>{NCR_DISPOSITION_LABELS[d]}</option>
                ))}
              </select>
              </FormField>
            </div>
            <div>
              <label htmlFor="cost_impact" className="block text-sm font-medium text-ink"><Tx>Cost impact</Tx> <span className="font-normal text-muted"><Tx>(optional)</Tx></span></label>
              <input id="cost_impact" name="cost_impact" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={costImpact ?? ""} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60" />
            </div>
            <div>
              <label htmlFor="schedule_impact_days" className="block text-sm font-medium text-ink"><Tx>Schedule impact (days)</Tx> <span className="font-normal text-muted"><Tx>(optional)</Tx></span></label>
              <input id="schedule_impact_days" name="schedule_impact_days" type="number" min="0" max="3650" step="1" inputMode="numeric" defaultValue={scheduleImpactDays ?? ""} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60" />
            </div>
          </div>
          <div>
            <label htmlFor="contractor_response" className="block text-sm font-medium text-ink"><Tx>Contractor response</Tx> <span className="font-normal text-muted"><Tx>(optional)</Tx></span></label>
            <textarea id="contractor_response" name="contractor_response" rows={2} maxLength={2000} defaultValue={contractorResponse ?? ""} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60" />
          </div>
        </fieldset>
      )}

      {!isClosed && canClose && selfVerifyConflict && status === "pending_verification" && (
        <div>
          <label htmlFor="close_override_reason" className="block text-sm font-medium text-ink">
            <Tx>Override reason</Tx> <span className="font-normal text-muted"><Tx>(you are assigned to this NCR or wrote its corrective action)</Tx></span>
          </label>
          <textarea id="close_override_reason" name="close_override_reason" rows={2} placeholder={isAdmin ? "Why you are verifying your own work (at least 10 characters; audited)" : "A different person must verify and close this NCR"} disabled={!isAdmin} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60" />
        </div>
      )}

      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}

      {!isClosed && (
        <div className="flex gap-3">
          <Button type="submit" name="close_now" value="false" variant="outline" disabled={pending || capaLocked}>
            {pending ? "Saving…" : "Save progress"}
          </Button>
          {canClose && (
            <Button type="submit" name="close_now" value="true" disabled={pending || !canCloseNow}>
              {pending ? "Closing…" : "Verify and close NCR"}
            </Button>
          )}
        </div>
      )}
      {!isClosed && canClose && !canCloseNow && (
        <p className="text-xs text-muted">
          <Tx>To close: status must be Pending verification, with root cause, corrective action, preventive action, verification notes and at least one evidence photo or linked document.</Tx>
          {photoCount === 0 ? " No evidence yet." : ""}
        </p>
      )}
      {capaLocked && <p className="text-xs text-muted"><Tx>Awaiting verification: CAPA is locked until JAGS staff verify or return it for rework.</Tx></p>}
      {!isClosed && !canClose && (
        <p className="text-xs text-muted"><Tx>Closing is done by a JAGS verifier after you send the NCR for verification.</Tx></p>
      )}
    </form>
    {!isClosed && canVerify && status === "pending_verification" && <ReturnForReworkForm ncrId={ncrId} onDone={onSaved} />}
    {isClosed && canClose && (
      <form action={reopenAction} className="mt-4 space-y-2 border-t border-border pt-4">
        <input type="hidden" name="ncr_id" value={ncrId} />
        <label htmlFor="reopen_reason" className="block text-sm font-medium text-ink"><Tx>Re-open this NCR</Tx></label>
        <textarea id="reopen_reason" name="reason" rows={2} required placeholder={tl("Reason for re-opening (required)")} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy" />
        {reopenState.error && <p role="alert" className="text-sm text-danger">{reopenState.error}</p>}
        <Button type="submit" variant="outline" disabled={reopenPending}>{reopenPending ? "Re-opening…" : "Re-open NCR"}</Button>
      </form>
    )}
    </div>
  );
}
