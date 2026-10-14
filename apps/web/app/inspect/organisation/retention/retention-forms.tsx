"use client";

import { useActionState, useState } from "react";
import { reviewRetentionFlagAction, saveRetentionSettingsAction, type RetentionState } from "@/lib/retention/actions";
import { MAX_RETENTION_YEARS, MIN_RETENTION_YEARS } from "@/lib/retention/logic";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Tx } from "@/components/domain/tx";
import { MoreDetails } from "@/components/domain/more-details";

const initialState: RetentionState = { error: null };

export function RetentionSettingsForm({
  organizationId,
  retentionYears,
  enabled,
}: {
  organizationId: string;
  retentionYears: number;
  enabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveRetentionSettingsAction, initialState);
  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <input type="hidden" name="organization_id" value={organizationId} />
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="h-4 w-4" />
        <Tx>Flag documents that are past the retention period</Tx>
      </label>
      <div>
        <label htmlFor={`retention_years_${organizationId}`} className="block text-xs font-medium text-ink">
          <Tx>Retention period (years)</Tx>
        </label>
        <input
          id={`retention_years_${organizationId}`}
          name="retention_years"
          type="number"
          inputMode="numeric"
          min={MIN_RETENTION_YEARS}
          max={MAX_RETENTION_YEARS}
          step={1}
          required
          defaultValue={retentionYears}
          className="mt-1 w-28 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <p className="text-xs text-muted"><strong><Tx>It never deletes, hides or changes a document.</Tx></strong></p>
      <MoreDetails className="mt-0">
        <p><Tx>The clock starts when a document was approved (or uploaded, if it never was). Once a day the system flags every document past the period for a human decision.</Tx></p>
      </MoreDetails>
      <FormMessage error={state.error} success={state.success} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save retention rule"}
      </Button>
    </form>
  );
}

export function ReviewFlagForm({ documentId }: { documentId: string }) {
  const [state, formAction, pending] = useActionState(reviewRetentionFlagAction, initialState);
  const [outcome, setOutcome] = useState<"keep" | "dispose_approved">("keep");
  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="document_id" value={documentId} />
      <div>
        <label htmlFor={`outcome_${documentId}`} className="block text-xs font-medium text-ink">
          <Tx>Decision</Tx>
        </label>
        <select
          id={`outcome_${documentId}`}
          name="outcome"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as "keep" | "dispose_approved")}
          className="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        >
          <option value="keep"><Tx>Keep</Tx></option>
          <option value="dispose_approved"><Tx>Approve disposal</Tx></option>
        </select>
      </div>
      <div className="min-w-48 flex-1">
        <label htmlFor={`note_${documentId}`} className="block text-xs font-medium text-ink">
          <Tx>Note</Tx>{outcome === "dispose_approved" ? " (required: who approved, and why)" : " (optional)"}
        </label>
        <input
          id={`note_${documentId}`}
          name="note"
          maxLength={2000}
          required={outcome === "dispose_approved"}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Record decision"}
      </Button>
      <FormMessage error={state.error} className="w-full" />
    </form>
  );
}
