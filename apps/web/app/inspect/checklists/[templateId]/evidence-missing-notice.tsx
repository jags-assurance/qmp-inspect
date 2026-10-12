"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CompleteInspectionForm } from "./complete-inspection-form";
import { Tx } from "@/components/domain/tx";

const MIN_REASON = 15;

/**
 * Shown instead of the sign-off form while the inspection has no evidence yet. Two ways forward
 * without leaving the page: a camera-first "Take a photo" button that opens the device camera
 * straight into the existing photo upload, or — for the rare inspection with genuinely nothing to
 * attach (e.g. a pure document-review check) — an explicit, written "no evidence applies" waiver.
 * The waiver needs a real reason, which the server stamps into the record's notes and the audit
 * trail, so it is never a silent bypass.
 */
export function EvidenceMissingNotice({
  templateId,
  inspectionRecordId,
  consistencySlot,
}: {
  templateId: string;
  inspectionRecordId: string;
  consistencySlot: ReactNode;
}) {
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState("");
  const reasonOk = reason.trim().length >= MIN_REASON;

  function takePhoto() {
    document.querySelector<HTMLInputElement>("#photo-input-camera")?.click();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-warning/10 p-4 text-sm text-ink">
        <p><Tx>Attach at least one evidence photo or linked document (★ required, above) before completing this inspection.</Tx></p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" onClick={takePhoto} className="min-h-11">
            <Tx>Take a photo</Tx>
          </Button>
          {!waiving && (
            <Button type="button" variant="outline" onClick={() => setWaiving(true)} className="min-h-11">
              <Tx>No evidence applies…</Tx>
            </Button>
          )}
        </div>
      </div>

      {waiving && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <label htmlFor="no-evidence-reason" className="block text-sm font-medium text-ink">
            <Tx>Why is there no evidence to attach?</Tx>
          </label>
          <p className="mt-0.5 text-xs text-muted">
            <Tx>Recorded on the inspection and in the audit log. Use only when nothing photographable or attachable exists for this activity.</Tx>
          </p>
          <textarea
            id="no-evidence-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
          {!reasonOk && <p className="mt-1 text-xs text-muted"><Tx>At least</Tx> {MIN_REASON} <Tx>characters.</Tx></p>}
          <button type="button" onClick={() => setWaiving(false)} className="mt-2 text-xs text-muted hover:text-ink">
            <Tx>Cancel — I&rsquo;ll attach evidence instead</Tx>
          </button>
        </div>
      )}

      {waiving && reasonOk && (
        <>
          {consistencySlot}
          <CompleteInspectionForm
            templateId={templateId}
            inspectionRecordId={inspectionRecordId}
            noEvidenceReason={reason.trim()}
          />
        </>
      )}
    </div>
  );
}
