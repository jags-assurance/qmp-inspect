"use client";

import { useRestoreOnError } from "@/lib/hooks/use-keep-form-values";
import { useActionState, useEffect, useRef, useState } from "react";
import { addSignatureAction, type AddSignatureState } from "@/lib/standalone/actions";
import { enqueueOutboxItem } from "@/lib/offline/db";
import { notifyOutboxChanged } from "@/lib/offline/sync-client";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { SignaturePad as SharedPad } from "@/components/domain/signature-pad";

const initialState: AddSignatureState = { error: null };

/** Plain HTML5 canvas + pointer events — no signature-pad package needed for this. */
export function SignaturePad({ assignmentId }: { assignmentId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(addSignatureAction, initialState);
  const captureForm = useRestoreOnError(state);
  const [signatureData, setSignatureData] = useState("");
  const [hasDrawn, setHasDrawn] = useState(false);
  const [queued, setQueued] = useState(false);
  const [padKey, setPadKey] = useState(0);

  function handleClear() {
    setPadKey((k) => k + 1);
    setSignatureData("");
    setHasDrawn(false);
  }

  // Clear the pad after a successful save so the same signature cannot be double-submitted.
  const wasPending = useRef(false);
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
    } else if (wasPending.current) {
      wasPending.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset after the save action completes (external event)
      if (!state.error) handleClear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleClear only touches setters
  }, [pending]);

  // Offline: keep the signature on this device and send it when the connection returns.
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    captureForm(e.currentTarget);
    setQueued(false);
    if (navigator.onLine) return;
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const fields: Record<string, string> = { kind: "standalone_signature" };
    for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) fields[k] = v;
    if (!fields.signature_data || !fields.role?.trim() || !fields.signatory_name?.trim()) return;
    await enqueueOutboxItem({ kind: "standalone_signature", fields });
    notifyOutboxChanged();
    handleClear();
    setQueued(true);
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="mt-4 space-y-3 border-t border-border pt-4">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <input type="hidden" name="signature_data" value={signatureData} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <FormField label="Role">
            <input
            name="role"
            required
            placeholder={tl("e.g. Client witness")}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy sm:text-sm [@media(pointer:coarse)]:min-h-11"
          />
          </FormField>
        </div>
        <div>
          <FormField label="Signatory name">
            <input
            name="signatory_name"
            required
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy sm:text-sm [@media(pointer:coarse)]:min-h-11"
          />
          </FormField>
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted"><Tx>Signature</Tx></label>
        <div className="mt-1">
          <SharedPad
            key={padKey}
            onChange={(d) => {
              setSignatureData(d ?? "");
              setHasDrawn(!!d);
            }}
          />
        </div>
      </div>

      {queued && <p className="text-sm text-muted"><Tx>Saved on this device — it will be sent when you&apos;re back online.</Tx></p>}
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}

      <Button
        type="submit"
        disabled={pending || !hasDrawn}
        variant="primary" size="lg" className="w-full sm:w-auto"
      >
        {pending ? "Saving…" : "+ Add signature"}
      </Button>
    </form>
  );
}
