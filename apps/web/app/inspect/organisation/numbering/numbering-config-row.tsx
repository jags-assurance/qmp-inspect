"use client";

import { useActionState, useState, useTransition } from "react";
import { checkClientCodeAction, upsertNumberingConfigAction, type ClientCodeCheckState, type NumberingSettingsState } from "@/lib/numbering/actions";
import type { NumberingDocType } from "@/lib/numbering/types";
import { formatDocumentNumber } from "@/lib/numbering/format";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { FormMessage } from "@/components/ui/form-message";
import { useTranslate } from "@/lib/i18n/locale-context";

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
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(upsertNumberingConfigAction, initialState);
  const [codeCheck, setCodeCheck] = useState<ClientCodeCheckState | null>(null);
  const [checking, startChecking] = useTransition();

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
      className="rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5"
    >
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="doc_type" value={docType} />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold text-ink">{DOC_TYPE_LABELS[docType]}</h3>
        <p className="min-w-0 text-xs text-muted">
          <Tx>Sample:</Tx>{" "}
          <span className="doc-id inline-block max-w-full break-all rounded-md bg-surface-subtle px-2 py-1 align-middle text-sm font-medium text-ink">{sample}</span>
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <FormField required label="Client code">
            <input
              name="client_code"
              required
              value={clientCode}
              onChange={(e) => setClientCode(e.target.value)}
              placeholder={tl("e.g. project number")}
              className="min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:min-h-10 sm:text-sm"
            />
          </FormField>
          <Button
            type="button"
            disabled={checking || !clientCode.trim()}
            onClick={() => {
              setCodeCheck(null);
              startChecking(async () => setCodeCheck(await checkClientCodeAction(organizationId, docType, clientCode)));
            }}
            variant="link" size="sm" className="mt-1"
          >
            {checking ? "Checking…" : "Check code for duplicates"}
          </Button>
        </div>

        <FormField label="Originator">
          <input
            name="originator_code"
            value={originatorCode}
            onChange={(e) => setOriginatorCode(e.target.value)}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:min-h-10 sm:text-sm"
          />
        </FormField>

        <FormField label="Separator">
          <input
            name="separator"
            value={separator}
            onChange={(e) => setSeparator(e.target.value)}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:min-h-10 sm:text-sm"
          />
        </FormField>

        <FormField label="Padding">
          <input
            name="sequence_padding"
            type="number"
            min={1}
            max={6}
            value={sequencePadding}
            onChange={(e) => setSequencePadding(Number(e.target.value))}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:min-h-10 sm:text-sm"
          />
        </FormField>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 sm:col-span-2 lg:col-span-3 lg:self-end">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="h-5 w-5" name="include_year" checked={includeYear} onChange={(e) => setIncludeYear(e.target.checked)} />
            <Tx>Year</Tx>
          </label>
          <label
            className="inline-flex min-h-11 items-center gap-2 text-sm text-ink"
            title={tl("Inserts this document's discipline code right after the doc-type segment, when one is resolvable — omitted otherwise, never a blank placeholder.")}
          >
            <input
              type="checkbox"
              className="h-5 w-5"
              name="include_discipline"
              checked={includeDiscipline}
              onChange={(e) => setIncludeDiscipline(e.target.checked)}
            />
            <Tx>Discipline</Tx>
          </label>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>

      {codeCheck && (
        <div
          role="status"
          className={`mt-3 rounded-md border px-3 py-2 text-sm ${
            codeCheck.status === "ok"
              ? "border-success/30 bg-success/5 text-success"
              : codeCheck.status === "warning"
                ? "border-warning/40 bg-warning/5 text-ink"
                : "border-danger/30 bg-danger/5 text-danger"
          }`}
        >
          <p>{codeCheck.message}</p>
          {codeCheck.suggestions.length > 0 && (
            <p className="mt-1 text-xs">
              <Tx>Unused project numbers you could use:</Tx>{" "}
              {codeCheck.suggestions.map((sugg) => (
                <Button
                  key={sugg}
                  type="button"
                  onClick={() => {
                    setClientCode(sugg);
                    setCodeCheck(null);
                  }}
                  variant="outline" size="sm" className="me-2"
                >
                  {sugg}
                </Button>
              ))}
            </p>
          )}
        </div>
      )}

      <FormMessage error={state.error} success={pending ? null : state.message} className="mt-3" />
    </form>
  );
}
