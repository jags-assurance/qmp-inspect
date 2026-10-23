"use client";

import { useActionState, useState } from "react";
import { sendTransmittalAction, type SendTransmittalState } from "@/lib/transmittals/actions";
import { MAX_TRANSMITTAL_MESSAGE_LENGTH, MAX_TRANSMITTAL_RECIPIENTS, parseRecipients } from "@/lib/transmittals/logic";
import type { TransmittalEntityType } from "@/lib/transmittals/logic";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: SendTransmittalState = { error: null };

/** Staff form: email a link to an issued document / Data Book to people outside the app (S7-26). */
export function TransmittalForm({
  entityType,
  entityId,
  projectId,
}: {
  entityType: TransmittalEntityType;
  entityId: string;
  projectId: string;
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(sendTransmittalAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  const [recipients, setRecipients] = useState("");
  const parsed = parseRecipients(recipients);
  const fieldCls = "mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy";

  return (
    <form onSubmit={keepValuesSubmit} className="mt-2 space-y-3 rounded-lg border border-border bg-surface p-4">
      <input type="hidden" name="entity_type" value={entityType} />
      <input type="hidden" name="entity_id" value={entityId} />
      <input type="hidden" name="project_id" value={projectId} />
      <div>
        <label htmlFor={`tx_recipients_${entityId}`} className="block text-xs font-medium text-ink">
          <Tx>Recipients (email addresses separated by commas, spaces or new lines; up to</Tx> {MAX_TRANSMITTAL_RECIPIENTS})
        </label>
        <textarea
          id={`tx_recipients_${entityId}`}
          name="recipients"
          rows={2}
          required
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          className={fieldCls}
          placeholder={tl("name@company.com")}
        />
        {recipients.trim() && (
          <p className={`mt-1 text-xs ${parsed.invalid.length > 0 ? "text-danger" : "text-muted"}`}>
            {parsed.invalid.length > 0
              ? `Not a valid address: ${parsed.invalid.slice(0, 3).join(", ")}`
              : `${parsed.valid.length} recipient${parsed.valid.length === 1 ? "" : "s"}`}
          </p>
        )}
      </div>
      <div>
        <label htmlFor={`tx_message_${entityId}`} className="block text-xs font-medium text-ink">
          <Tx>Message (optional)</Tx>
        </label>
        <textarea id={`tx_message_${entityId}`} name="message" rows={3} maxLength={MAX_TRANSMITTAL_MESSAGE_LENGTH} className={fieldCls} />
      </div>
      <p className="text-xs text-muted">
        <Tx>The email contains a link, not the file: recipients sign in to JAGS Assurance to open it, so they need an account with access to this project. Every send is logged below.</Tx>
      </p>
      <FormMessage error={state.error} success={state.success} />
      <Button type="submit" disabled={pending || parsed.valid.length === 0 || parsed.invalid.length > 0}>
        {pending ? "Sending…" : "Send transmittal"}
      </Button>
    </form>
  );
}
