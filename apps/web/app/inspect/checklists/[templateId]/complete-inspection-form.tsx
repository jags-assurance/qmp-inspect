"use client";

import { useActionState, useState } from "react";
import { completeInspectionAction, type CompleteInspectionState } from "@/lib/checklists/actions";
import { SignaturePad } from "@/components/domain/signature-pad";
import { Button } from "@/components/ui/button";

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

  return (
    <form action={formAction} className="rounded-lg border border-border bg-surface p-6">
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
        className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
      />

      <Button type="submit" disabled={pending || !signature} className="mt-4">
        {pending ? "Completing…" : "Complete inspection"}
      </Button>
      {state.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
