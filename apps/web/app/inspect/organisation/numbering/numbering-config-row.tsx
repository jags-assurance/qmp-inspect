"use client";

import { useActionState, useState } from "react";
import { upsertNumberingConfigAction, type NumberingSettingsState } from "@/lib/numbering/actions";
import type { NumberingDocType } from "@/lib/numbering/types";
import { formatDocumentNumber } from "@/lib/numbering/format";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";

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
  /** R104: opt-in discipline segment, inserted right after the doc-type segment. */
  includeDiscipline: boolean;
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

  // Live preview — computed with the exact same formatDocumentNumber logic the server actually
  // generates a real number with (lib/numbering/format.ts), so what's shown here can never drift
  // out of sync with what a real document actually gets numbered. Fields default to the same
  // fallbacks generate.ts itself falls back to when a row is left blank, so an unconfigured type's
  // sample matches its real default-format output too.
  const [clientCode, setClientCode] = useState(config?.clientCode ?? "");
  const [originatorCode, setOriginatorCode] = useState(config?.originatorCode ?? "JAGS");
  const [separator, setSeparator] = useState(config?.separator ?? "-");
  const [sequencePadding, setSequencePadding] = useState(config?.sequencePadding ?? 3);
  const [includeYear, setIncludeYear] = useState(config?.includeYear ?? false);
  const [includeDiscipline, setIncludeDiscipline] = useState(config?.includeDiscipline ?? false);

  // "MEC" is a placeholder for the preview only, same spirit as the "PROJ-2026-001" clientCode
  // fallback above — a real document's discipline segment always comes from that document's own
  // resolved master_disciplines.code (lib/ncrs/actions.ts), never a fabricated value.
  const sample = formatDocumentNumber(
    { clientCode: clientCode || "PROJ-2026-001", originatorCode, docType, seq: 1, disciplineCode: "MEC" },
    { separator, sequencePadding: sequencePadding || 1, includeYear, includeDiscipline }
  );

  return (
    <form
      action={formAction}
      className="grid grid-cols-2 items-end gap-2 border-b border-border py-3 last:border-0 sm:grid-cols-4 xl:grid-cols-[120px_1fr_100px_80px_90px_90px_100px_auto]"
    >
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="doc_type" value={docType} />

      <span className="pb-2 text-sm font-medium text-ink">{DOC_TYPE_LABELS[docType]}</span>

      <div>
        <FormField label="Client code">
          <input
          name="client_code"
          required
          value={clientCode}
          onChange={(e) => setClientCode(e.target.value)}
          placeholder="e.g. project number"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div>
        <FormField label="Originator">
          <input
          name="originator_code"
          value={originatorCode}
          onChange={(e) => setOriginatorCode(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div>
        <FormField label="Separator">
          <input
          name="separator"
          value={separator}
          onChange={(e) => setSeparator(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div>
        <FormField label="Padding">
          <input
          name="sequence_padding"
          type="number"
          min={1}
          max={6}
          value={sequencePadding}
          onChange={(e) => setSequencePadding(Number(e.target.value))}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <label className="flex items-center gap-1.5 pb-2 text-xs text-muted">
        <input type="checkbox" name="include_year" checked={includeYear} onChange={(e) => setIncludeYear(e.target.checked)} />
        Year
      </label>

      <label
        className="flex items-center gap-1.5 pb-2 text-xs text-muted"
        title="Inserts this document's discipline code right after the doc-type segment, when one is resolvable — omitted otherwise, never a blank placeholder."
      >
        <input
          type="checkbox"
          name="include_discipline"
          checked={includeDiscipline}
          onChange={(e) => setIncludeDiscipline(e.target.checked)}
        />
        Discipline
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>

      <p className="col-span-full text-xs text-muted">
        Sample: <span className="doc-id font-medium text-ink">{sample}</span>
      </p>

      {state.error && <p className="col-span-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
