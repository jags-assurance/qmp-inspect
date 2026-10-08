"use client";

import { useActionState, useRef, useState, type FormEvent } from "react";
import { acknowledgeHandoverAction, type AcknowledgeHandoverState } from "@/lib/handover/actions";
import { ACK_EVIDENCE_MAX_BYTES, buildAckEvidencePath, isAckSignatureRequired, validateAckEvidenceFile } from "@/lib/handover/helpers";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { GENERATED_DOCUMENTS_BUCKET } from "@/lib/reports/types";
import { uploadWithResume } from "@/lib/storage/upload-client";
import { Button } from "@/components/ui/button";
import { ConfirmTypeDialog } from "@/components/domain/confirm-type-dialog";
import { SignaturePad } from "@/components/domain/signature-pad";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: AcknowledgeHandoverState = { error: null };

/** The client's own action on their handover package — see acknowledge_handover() in the migration. */
export function AcknowledgeForm({
  certificateId,
  dataBookId,
  certificateNumber,
  onBehalf = false,
  userName,
  signatureEnabled = false,
}: {
  certificateId: string;
  /** Folder of the optional supporting file: handover-ack/<data book id>/... */
  dataBookId: string;
  certificateNumber: string;
  /** True when a JAGS admin is recording the acceptance on the client's behalf. */
  onBehalf?: boolean;
  userName?: string;
  /** False until the signature columns exist (migration 20261112000101): the pad and file upload are hidden. */
  signatureEnabled?: boolean;
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(acknowledgeHandoverAction, initialState);
  const [expanded, setExpanded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const evidencePathRef = useRef<HTMLInputElement>(null);
  const evidenceNameRef = useRef<HTMLInputElement>(null);
  const evidenceSizeRef = useRef<HTMLInputElement>(null);
  /** The file already uploaded for this attempt, so a retry after a server error does not upload it again. */
  const uploadedRef = useRef<{ key: string; path: string } | null>(null);
  const go = useRef(false);
  const signatureRequired = isAckSignatureRequired({ signatureEnabled, onBehalf });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (go.current) {
      go.current = false;
      return;
    }
    e.preventDefault();
    setLocalError(null);
    if (signatureRequired && !signature) {
      setLocalError("Sign in the signature box before confirming.");
      return;
    }
    setDialog(true);
  }

  /** Uploads the supporting file (if any) straight to storage, then submits the form with its path. */
  async function uploadEvidenceThenSubmit() {
    setLocalError(null);
    if (evidenceFile && signatureEnabled) {
      const key = `${evidenceFile.name}:${evidenceFile.size}:${evidenceFile.lastModified}`;
      let path = uploadedRef.current?.key === key ? uploadedRef.current.path : null;
      if (!path) {
        const fileError = validateAckEvidenceFile(evidenceFile);
        if (fileError) {
          setLocalError(fileError);
          return;
        }
        const target = buildAckEvidencePath(dataBookId, evidenceFile.name);
        setUploadStatus("Uploading the supporting file…");
        const { error } = await uploadWithResume(createSupabaseBrowserClient(), {
          bucket: GENERATED_DOCUMENTS_BUCKET,
          path: target,
          file: evidenceFile,
          onProgress: (f) => setUploadStatus(`Uploading the supporting file (${Math.round(f * 100)}%)…`),
        });
        setUploadStatus(null);
        if (error) {
          setLocalError("The supporting file could not be uploaded. Check your connection and try again, or remove the file.");
          return;
        }
        uploadedRef.current = { key, path: target };
        path = target;
      }
      if (evidencePathRef.current) evidencePathRef.current.value = path;
      if (evidenceNameRef.current) evidenceNameRef.current.value = evidenceFile.name;
      if (evidenceSizeRef.current) evidenceSizeRef.current.value = String(evidenceFile.size);
    } else {
      if (evidencePathRef.current) evidencePathRef.current.value = "";
      if (evidenceNameRef.current) evidenceNameRef.current.value = "";
      if (evidenceSizeRef.current) evidenceSizeRef.current.value = "";
    }
    go.current = true;
    formRef.current?.requestSubmit();
  }

  if (!expanded) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setExpanded(true)}>
        {onBehalf ? "Acknowledge on behalf of client" : "Acknowledge receipt"}
      </Button>
    );
  }

  const nameId = `ack_name_${certificateId}`;
  const companyId = `ack_company_${certificateId}`;
  const confirmId = `ack_confirm_${certificateId}`;

  return (
    <>
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="flex w-full flex-wrap items-end gap-2">
      <input type="hidden" name="certificate_id" value={certificateId} />
      {signatureEnabled && <input type="hidden" name="signature_enabled" value="1" />}
      <input type="hidden" name="signature" value={signature ?? ""} />
      <input ref={evidencePathRef} type="hidden" name="evidence_path" defaultValue="" />
      <input ref={evidenceNameRef} type="hidden" name="evidence_name" defaultValue="" />
      <input ref={evidenceSizeRef} type="hidden" name="evidence_size" defaultValue="" />

      {onBehalf && (
        <p className="w-full rounded-md bg-warning/10 px-3 py-2 text-sm text-ink">
          <Tx>You are recording this acceptance</Tx> <strong><Tx>on behalf of the client</Tx></strong> <Tx>as JAGS staff. It will be marked as such on the certificate and in the audit log.</Tx>
        </p>
      )}
      <p className="w-full text-xs text-muted">
        <Tx>Acknowledging as</Tx> <span className="font-medium text-ink">{userName ?? "you"}</span> <Tx>at the time you confirm. This is a formal acceptance of the handover package.</Tx>
      </p>

      <div className="w-full sm:w-auto">
        <label htmlFor={nameId} className="block text-xs font-medium text-ink">
          {onBehalf ? "Client representative name" : "Your name"}
        </label>
        <input
          id={nameId}
          name="received_by_name"
          required
          maxLength={120}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy sm:w-40"
        />
      </div>
      <div className="w-full sm:w-auto">
        <label htmlFor={companyId} className="block text-xs font-medium text-ink">
          <Tx>Company</Tx>
        </label>
        <input
          id={companyId}
          name="received_by_company"
          maxLength={120}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy sm:w-40"
        />
      </div>

      <div className="w-full">
        <label htmlFor={`ack_comment_${certificateId}`} className="block text-xs font-medium text-ink">
          <Tx>Comments (optional, recorded with the acceptance)</Tx>
        </label>
        <textarea id={`ack_comment_${certificateId}`} name="ack_comment" rows={2} maxLength={2000} className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy" />
      </div>
      {onBehalf && (
        <div className="w-full">
          <label htmlFor={`ack_basis_${certificateId}`} className="block text-xs font-medium text-ink">
            <Tx>How did the client confirm? (email, signed document reference)</Tx>
          </label>
          <input id={`ack_basis_${certificateId}`} name="on_behalf_basis" required minLength={5} maxLength={1000} className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy" />
        </div>
      )}

      {signatureEnabled && (
        <div className="w-full">
          <p className="block text-xs font-medium text-ink">
            {onBehalf ? "Client signature (optional when recording on their behalf)" : "Sign to accept"}
          </p>
          <div className="mt-1 max-w-md">
            <SignaturePad onChange={setSignature} />
          </div>
          <label htmlFor={`ack_evidence_${certificateId}`} className="mt-3 block text-xs font-medium text-ink">
            <Tx>Supporting file (optional, for example a signed acceptance letter or an email export)</Tx>
          </label>
          <input
            id={`ack_evidence_${certificateId}`}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt,.eml,.msg"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0] ?? null;
              setLocalError(f ? validateAckEvidenceFile(f) : null);
              setEvidenceFile(f);
            }}
            className="mt-1 block w-full max-w-md text-sm text-ink file:me-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm"
          />
          <p className="mt-1 text-xs text-muted">
            <Tx>Up to</Tx> {Math.round(ACK_EVIDENCE_MAX_BYTES / (1024 * 1024))} <Tx>MB. It is stored with the acknowledgement and cannot be changed afterwards.</Tx>
          </p>
        </div>
      )}

      <label htmlFor={confirmId} className="flex w-full items-start gap-2 text-sm text-ink">
        <input id={confirmId} name="confirm" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4" />
        <span>
          <Tx>I confirm the handover package was received and that this is a formal acceptance</Tx>
          {onBehalf ? " recorded on behalf of the client" : ""}<Tx>. It cannot be undone.</Tx>
        </span>
      </label>

      <Button type="submit" size="sm" disabled={pending || !!uploadStatus || !confirmed}>
        {uploadStatus ?? (pending ? "Confirming…" : "Confirm acceptance")}
      </Button>

      {(localError || state.error) && (
        <p className="w-full text-sm text-danger" role="alert">
          {localError ?? state.error}
        </p>
      )}
    </form>
    {dialog && (
      <ConfirmTypeDialog
        title={tl("Record formal acceptance?")}
        phrase=""
        confirmLabel="Accept handover"
        onCancel={() => setDialog(false)}
        onConfirm={() => {
          setDialog(false);
          void uploadEvidenceThenSubmit();
        }}
      >
        <p>
          <Tx>This formally accepts handover certificate</Tx> <strong>{certificateNumber}</strong>{onBehalf ? " on behalf of the client" : ""}<Tx>. It cannot be undone.</Tx>
        </p>
      </ConfirmTypeDialog>
    )}
    </>
  );
}
