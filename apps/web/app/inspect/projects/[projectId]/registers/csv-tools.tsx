"use client";

import { useActionState } from "react";
import { importRegisterCsvAction, type ImportRegisterCsvState } from "@/lib/registers/import-actions";
import { FormMessage } from "@/components/ui/form-message";
import type { CsvRegisterKind } from "@/lib/registers/csv-columns";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: ImportRegisterCsvState = { error: null, lineErrors: [], imported: null, duplicates: 0 };

/** Export / template download for every viewer, plus a CSV import for people who can add entries. */
export function RegisterCsvTools({ projectId, kind, canAdd }: { projectId: string; kind: CsvRegisterKind; canAdd: boolean }) {
  const tl = useTranslate();
  const [state, action, pending] = useActionState(importRegisterCsvAction, initialState);
  return (
    <details className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-ink"><Tx>Import / export CSV</Tx></summary>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        <a className="text-burgundy hover:underline" href={`/api/registers/export?kind=${kind}&project_id=${projectId}`}>
          <Tx>Export this register (CSV)</Tx>
        </a>
        <a className="text-burgundy hover:underline" href={`/api/registers/export?kind=${kind}&project_id=${projectId}&template=1`}>
          <Tx>Download a blank template</Tx>
        </a>
      </div>
      {canAdd && (
        <form action={action} className="mt-3 space-y-2">
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="kind" value={kind} />
          <p className="text-xs text-muted">
            <Tx>Paste CSV or choose a file. If any line has a problem, nothing is imported.</Tx>
          </p>
          <textarea name="csv_text" rows={4} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs outline-none focus:border-burgundy" aria-label={tl("CSV text")} />
          <input type="file" name="csv_file" accept=".csv,text/csv" className="block text-xs" aria-label={tl("CSV file")} />
          <FormMessage
            error={state.error}
            success={
              state.imported !== null && state.imported > 0
                ? `✓ Imported ${state.imported} entr${state.imported === 1 ? "y" : "ies"}${
                    state.duplicates > 0 ? ` (${state.duplicates} duplicate${state.duplicates === 1 ? "" : "s"} skipped)` : ""
                  }.`
                : null
            }
          />
          {state.lineErrors.length > 0 && (
            <ul className="list-disc ps-5 text-xs text-danger">
              {state.lineErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <button type="submit" disabled={pending} className="rounded-md bg-burgundy px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {pending ? "Importing…" : "Import"}
          </button>
        </form>
      )}
    </details>
  );
}
