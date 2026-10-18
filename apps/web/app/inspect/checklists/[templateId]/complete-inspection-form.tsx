"use client";

import { useState } from "react";
import { completeInspectionAction, type CompleteInspectionState } from "@/lib/checklists/actions";
import { SignaturePad } from "@/components/domain/signature-pad";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { validateCompletionFieldsClient } from "@/lib/checklists/completion-logic";
import { enqueueOutboxItem } from "@/lib/offline/db";
import { notifyOutboxChanged } from "@/lib/offline/sync-client";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: CompleteInspectionState = { error: null };

export function CompleteInspectionForm({
  templateId,
  inspectionRecordId,
  noEvidenceReason,
}: {
  templateId: string;
  inspectionRecordId: string;
  /** Set only when the inspector explicitly waived the evidence requirement with a written reason. */
  noEvidenceReason?: string;
}) {
  const tl = useTranslate();
  const [state, setState] = useState<CompleteInspectionState>(initialState);
  const [pending, setPending] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [witnessSignature, setWitnessSignature] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [witnessName, setWitnessName] = useState("");
  const [witnessOpen, setWitnessOpen] = useState(false);
  const [queued, setQueued] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();

  // Offline (R60): completeInspectionAction always redirects on success, which needs a live
  // navigation — it can't be the fallback path. Instead, queue the same fields the action expects
  // and let the offline-sync route (which calls completeInspectionCore, the redirect-free half of
  // the same logic) replay it once back online.
  async function queueCompletion(formData: FormData) {
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setQueueError(null);
    const formData = new FormData(e.currentTarget);
    // Same field checks the server applies, run first so an offline queue never holds a completion
    // the server would refuse later (S4-05).
    const fieldProblem = validateCompletionFieldsClient({
      signature: String(formData.get("signature") ?? ""),
      witnessName: String(formData.get("witness_name") ?? ""),
      witnessSignature: String(formData.get("witness_signature") ?? ""),
    });
    if (fieldProblem) {
      setState({ error: fieldProblem });
      return;
    }
    setState(initialState);
    // One tap permanently locks the record (a Fail also raises punch items and notifications): confirm first.
    const ok = await ask({
      title: "Complete and sign this inspection?",
      message: "It is locked once completed and can only be changed by re-opening it (audited).",
      confirmLabel: "Complete and sign",
    });
    if (ok === null) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await queueCompletion(formData);
      return;
    }
    setPending(true);
    try {
      // A redirect on success is handled by Next; a dropped connection throws, and the signature the
      // inspector just drew is queued instead of being lost to the error boundary.
      const result = await completeInspectionAction(initialState, formData);
      if (result?.error) setState(result);
    } catch (err) {
      if (err && typeof err === "object" && "digest" in err) throw err; // NEXT_REDIRECT
      await queueCompletion(formData);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
      {dialog}
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
      <input type="hidden" name="signature" value={signature ?? ""} />
      <input type="hidden" name="witness_signature" value={witnessOpen ? (witnessSignature ?? "") : ""} />
      {noEvidenceReason && <input type="hidden" name="no_evidence_reason" value={noEvidenceReason} />}

      <h2 className="text-base font-medium text-ink">
        <Tx>Field Engineer sign-off</Tx> <span className="text-danger">*</span>
      </h2>

      <label htmlFor="signed_by_name" className="mt-3 block text-sm font-medium text-ink">
        <Tx>Printed name</Tx>
      </label>
      <input
        id="signed_by_name"
        name="signed_by_name"
        value={signerName}
        onChange={(e) => setSignerName(e.target.value)}
        placeholder={tl("Defaults to your account name")}
        maxLength={120}
        className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy sm:text-sm [@media(pointer:coarse)]:min-h-11"
      />
      <p className="mt-1 text-xs text-muted">
        <Tx>The date and time are stamped automatically when you complete. The record is also stamped with your signed-in account, whatever name you type.</Tx>
      </p>
      <div className="mt-3">
        <SignaturePad onChange={setSignature} />
      </div>
      {!signature && (
        <p className="mt-1 text-xs text-muted"><Tx>Sign above — a signature is required to complete the inspection.</Tx></p>
      )}

      <div className="mt-4 rounded-md border border-border p-3">
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink">
          <input type="checkbox" className="h-5 w-5" checked={witnessOpen} onChange={(e) => setWitnessOpen(e.target.checked)} />
          <Tx>Add a witness signature (optional)</Tx>
        </label>
        {witnessOpen && (
          <div className="mt-3 space-y-3">
            <input
              name="witness_name"
              value={witnessName}
              onChange={(e) => setWitnessName(e.target.value)}
              placeholder={tl("Witness name and company")}
              maxLength={120}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy sm:text-sm [@media(pointer:coarse)]:min-h-11"
            />
            <SignaturePad onChange={setWitnessSignature} />
          </div>
        )}
      </div>

      <label htmlFor="notes"className="mt-4 block text-sm font-medium text-ink">
        <Tx>Notes (optional)</Tx>
      </label>
      <textarea
        id="notes"
        name="notes"
        rows={3}
        disabled={queued}
        className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy sm:text-sm [@media(pointer:coarse)]:min-h-11 disabled:opacity-60"
      />

      <Button type="submit" disabled={pending || !signature || queued || (witnessOpen && !!witnessSignature && !witnessName.trim())} size="lg" className="mt-4 w-full">
        {queued ? "Queued — will complete when back online" : pending ? "Completing…" : "Complete inspection"}
      </Button>
      {queued && (
        <p className="mt-2 text-sm text-warning">
          <Tx>You&apos;re offline. This inspection will be completed automatically once your connection is back.</Tx>
        </p>
      )}
      {state.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
      {queueError && <p role="alert" className="mt-2 text-sm text-danger">{queueError}</p>}
    </form>
  );
}
