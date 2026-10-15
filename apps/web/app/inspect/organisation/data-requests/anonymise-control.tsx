"use client";

import { useActionState } from "react";
import { anonymiseUserAction, type AnonymiseState } from "@/lib/data-requests/actions";
import { MIN_REASON_LENGTH } from "@/lib/data-requests/anonymise";
import { FormMessage } from "@/components/ui/form-message";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";

const initialState: AnonymiseState = { error: null, message: null };

/** Anonymise one account: a confirm dialog that requires a typed reason, which is kept in the audit log. */
export function AnonymiseControl({ userId, name }: { userId: string; name: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(anonymiseUserAction, initialState);
  const { gateSubmit, dialog } = useConfirm();
  return (
    <form
      action={formAction}
      onSubmit={gateSubmit(
        {
          title: `${tl("Anonymise")} ${name}?`,
          message: tl(
            "Replaces the name and email with placeholders and deactivates the account. All records, signatures and audit history are kept. This cannot be undone."
          ),
          confirmLabel: tl("Anonymise account"),
          destructive: true,
          reason: {
            label: tl("Reason for this request (kept in the audit log)"),
            minLength: MIN_REASON_LENGTH,
            required: true,
            placeholder: tl("For example: erasure request received 2026-10-08, identity verified, no legal hold"),
          },
        },
        "reason"
      )}
      className="flex flex-col items-start gap-2"
    >
      {dialog}
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="reason" defaultValue="" />
      <Button
        type="submit"
        disabled={pending}
        variant="danger"
      >
        {pending ? tl("Working…") : tl("Anonymise account…")}
      </Button>
      <FormMessage error={state.error} success={state.message} />
      <p className="text-xs text-muted">
        <Tx>Anonymising keeps every record; it only removes who the account belonged to.</Tx>
      </p>
    </form>
  );
}
