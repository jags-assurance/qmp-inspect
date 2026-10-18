"use client";

import { useActionState } from "react";
import {
  updateSignoffAutomationSettingsAction,
  type SignoffAutomationSettingsState,
} from "@/lib/signoff/automation-settings-actions";
import { Button } from "@/components/ui/button";

const initialState: SignoffAutomationSettingsState = { error: null };

export function SignoffAutomationForm({
  organizationId,
  autoNotify,
  autoProceed,
  available,
}: {
  organizationId: string;
  autoNotify: boolean;
  autoProceed: boolean;
  /** False until the database update adding these settings has been applied. */
  available: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateSignoffAutomationSettingsAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organization_id" value={organizationId} />
      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-burgundy">
        <input type="checkbox" name="auto_notify_signoffs" defaultChecked={autoNotify} disabled={!available} className="mt-1" />
        <span>
          <span className="block text-sm font-medium text-ink">Notify the next people automatically</span>
          <span className="block text-xs text-muted">
            When an ITP is approved or accepted, or a lower step is cleared, the next people who need to sign are
            notified without anyone pressing Notify. Each is notified once.
          </span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-burgundy">
        <input type="checkbox" name="auto_proceed_after_notice" defaultChecked={autoProceed} disabled={!available} className="mt-1" />
        <span>
          <span className="block text-sm font-medium text-ink">Let Witness and Surveillance proceed if nobody responds</span>
          <span className="block text-xs text-muted">
            If a notified Witness or Surveillance point gets no response within its notice period, work may proceed
            and it is recorded as &quot;proceeded without response&quot;. It is never counted as signed off. Hold points and
            Reviews always wait for a real sign-off, and nothing is ever signed on anyone&apos;s behalf.
          </span>
        </span>
      </label>
      {!available && (
        <p className="text-xs text-muted">These settings become available once the latest database update is applied.</p>
      )}
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state.saved && !state.error && <p role="status" className="text-sm text-muted">Saved.</p>}
      <Button type="submit" disabled={pending || !available}>
        {pending ? "Saving…" : "Save automation settings"}
      </Button>
    </form>
  );
}
