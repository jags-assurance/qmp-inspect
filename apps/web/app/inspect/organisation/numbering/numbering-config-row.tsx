"use client";

import { useActionState } from "react";
import { upsertNumberingConfigAction, type NumberingSettingsState } from "@/lib/numbering/actions";
import type { NumberingDocType } from "@/lib/numbering/types";
import { Button } from "@/components/ui/button";

const initialState: NumberingSettingsState = { error: null };

const DOC_TYPE_LABELS: Record<NumberingDocType, string> = {
  itp: "ITP",
  ncr: "NCR",
  checklist: "Checklist",
  irn: "IRN",
  standalone_assignment: "Standalone assignment",
  vault_document: "Vault document",
};

export interface NumberingConfigFormValues {
  clientCode: string;
  originatorCode: string;
  separator: string;
  sequencePadding: number;
  includeYear: boolean;
}

export function NumberingConfigRow({
  organizationId,
  docType,
  config,
}: {
  organizationId: string;
  docType: NumberingDocType;
  config: NumberingConfigFormValues | null;
}) {
  const [state, formAction, pending] = useActionState(upsertNumberingConfigAction, initialState);

  return (
    <form
      action={formAction}
      className="grid grid-cols-[120px_1fr_100px_80px_90px_90px_auto] items-end gap-2 border-b border-border py-3 last:border-0"
    >
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="doc_type" value={docType} />

      <span className="pb-2 text-sm font-medium text-ink">{DOC_TYPE_LABELS[docType]}</span>

      <div>
        <label className="block text-xs text-muted">Client code</label>
        <input
          name="client_code"
          required
          defaultValue={config?.clientCode ?? ""}
          placeholder="e.g. project number"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div>
        <label className="block text-xs text-muted">Originator</label>
        <input
          name="originator_code"
          defaultValue={config?.originatorCode ?? "JAGS"}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div>
        <label className="block text-xs text-muted">Separator</label>
        <input
          name="separator"
          defaultValue={config?.separator ?? "-"}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div>
        <label className="block text-xs text-muted">Padding</label>
        <input
          name="sequence_padding"
          type="number"
          min={1}
          max={6}
          defaultValue={config?.sequencePadding ?? 3}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <label className="flex items-center gap-1.5 pb-2 text-xs text-muted">
        <input type="checkbox" name="include_year" defaultChecked={config?.includeYear ?? false} />
        Year
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>

      {state.error && <p className="col-span-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
