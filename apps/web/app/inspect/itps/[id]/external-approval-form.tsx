"use client";

import { useActionState } from "react";
import { recordExternalApprovalAction, type RecordExternalApprovalState } from "@/lib/itps/actions";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: RecordExternalApprovalState = { error: null };

/**
 * R80: lets staff record that the client approved this ITP in their OWN external system (e.g.
 * "Approved in client's Aconex system, ref AX-2026-4471") instead of clicking Accept in this app.
 * Not editable inline once set — re-submitting the form overwrites the reference/recorded-by/
 * recorded-at, which is enough to correct a mistake without a separate edit-lock flow.
 */
export function ExternalApprovalForm({
  itpId,
  reference,
  recordedByName,
  recordedAt,
}: {
  itpId: string;
  reference: string | null;
  recordedByName: string | null;
  recordedAt: string | null;
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(recordExternalApprovalAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <Disclosure variant="pill" summary={<><Tx>External approval reference</Tx></>} className="mt-6" defaultOpen={!!reference}>
      <div className="mt-2 rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-muted">
        <Tx>Use this if the client approved the ITP in their own system.</Tx>
      </p>

      {reference && (
        <div className="mt-3 rounded-md border border-border bg-off-white/60 p-3 text-sm">
          <p className="text-ink">{reference}</p>
          {(recordedByName || recordedAt) && (
            <p className="mt-1 text-xs text-muted">
              <Tx>Recorded by</Tx> {recordedByName ?? "unknown"}
              {recordedAt ? ` on ${new Date(recordedAt).toLocaleString("en-GB")}` : ""}
            </p>
          )}
        </div>
      )}

      <form onSubmit={keepValuesSubmit} className="mt-3 flex flex-wrap items-start gap-2">
        <input type="hidden" name="itp_id" value={itpId} />
        <input
          type="text"
          name="reference"
          placeholder={tl("e.g. Approved in client's Aconex system, ref AX-2026-4471")}
          defaultValue={reference ?? ""}
          required
          className="w-full sm:min-w-[20rem] flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        <Button
          type="submit"
          disabled={pending}
          variant="outline"
        >
          {pending ? "Saving…" : reference ? "Update reference" : "Record reference"}
        </Button>
      </form>
      {state.error && <p role="alert" className="mt-1 text-xs text-danger">{state.error}</p>}
      </div>
</Disclosure>
  );
}
