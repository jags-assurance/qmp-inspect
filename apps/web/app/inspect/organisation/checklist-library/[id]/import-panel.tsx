"use client";

import { useActionState, useState } from "react";
import {
  parseLibraryImportAction,
  commitLibraryImportAction,
  type ParseImportState,
  type CommitImportState,
} from "@/lib/checklist-library/actions";
import type { ParsedLibraryItemRow } from "@/lib/checklist-library/types";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";

const parseInitialState: ParseImportState = { error: null, rows: null };
const commitInitialState: CommitImportState = { error: null, addedCount: 0 };

/**
 * R47: upload an .xlsx matching the export's column layout, parse it server-side, and show every
 * parsed row back to the reviewer for edit/removal BEFORE anything is committed — a real
 * preview-and-validate step, not a silent import. A row missing its item number or description (or
 * duplicating one already in the file) is flagged inline rather than silently dropped; the Import
 * button stays disabled while any flagged row remains, and the reviewer can edit a cell to clear the
 * flag or remove the row outright.
 */
export function ImportPanel({ templateId }: { templateId: string }) {
  const [parseState, parseFormAction, parsePending] = useActionState(parseLibraryImportAction, parseInitialState);
  const [commitState, commitFormAction, commitPending] = useActionState(commitLibraryImportAction, commitInitialState);

  const [rows, setRows] = useState<ParsedLibraryItemRow[] | null>(null);

  const [appliedParseState, setAppliedParseState] = useState(parseState);
  if (parseState !== appliedParseState) {
    setAppliedParseState(parseState);
    if (parseState.rows) setRows(parseState.rows);
  }

  const [appliedCommitState, setAppliedCommitState] = useState(commitState);
  if (commitState !== appliedCommitState) {
    setAppliedCommitState(commitState);
    if (commitState.addedCount > 0) setRows(null);
  }

  function revalidateRow(row: ParsedLibraryItemRow, allRows: ParsedLibraryItemRow[], index: number): ParsedLibraryItemRow {
    let validationError: string | null = null;
    if (!row.item_number.trim()) validationError = "Missing item number.";
    else if (!row.description.trim()) validationError = "Missing description.";
    else if (allRows.some((r, i) => i !== index && r.item_number.trim() === row.item_number.trim()))
      validationError = `Duplicate item number "${row.item_number}" in this file.`;
    return { ...row, validationError };
  }

  function updateRow(index: number, patch: Partial<ParsedLibraryItemRow>) {
    setRows((prev) => {
      if (!prev) return prev;
      const next = prev.map((r, i) => (i === index ? { ...r, ...patch } : r));
      return next.map((r, i) => revalidateRow(r, next, i));
    });
  }

  function removeRow(index: number) {
    setRows((prev) => {
      if (!prev) return prev;
      const next = prev.filter((_, i) => i !== index);
      return next.map((r, i) => revalidateRow(r, next, i));
    });
  }

  const invalidCount = rows?.filter((r) => r.validationError).length ?? 0;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      {!rows && (
        <form action={parseFormAction} className="space-y-2">
          <input type="hidden" name="template_id" value={templateId} />
          <input
            type="file"
            name="file"
            accept=".xlsx"
            required
            className="block w-full text-sm text-ink file:me-3 file:rounded-md file:border file:border-border file:bg-off-white file:px-3 file:py-1.5 file:text-xs file:font-medium"
          />
          <p className="text-xs text-muted">
            <Tx>Upload an .xlsx with the same columns as the downloaded template (Item Number, Description, Acceptance Criteria, Evidence Type, Mandatory). Nothing is saved until you review the parsed rows and confirm.</Tx>
          </p>
          {parseState.error && <p role="alert" className="text-xs text-danger">{parseState.error}</p>}
          <Button type="submit" size="sm" disabled={parsePending}>
            {parsePending ? "Parsing…" : "Parse file"}
          </Button>
        </form>
      )}

      {rows && (
        <form action={commitFormAction} className="space-y-3">
          <input type="hidden" name="template_id" value={templateId} />
          <input type="hidden" name="rows_json" value={JSON.stringify(rows)} readOnly />

          <p className="text-xs font-medium text-ink">
            {rows.length} <Tx>row</Tx>{rows.length === 1 ? "" : "s"} <Tx>parsed</Tx>
            {invalidCount > 0 && <span className="text-danger"> — {invalidCount} <Tx>need attention before importing</Tx></span>}
          </p>

          <div className="max-h-96 space-y-2 overflow-y-auto">
            {rows.map((row, index) => (
              <div
                key={index}
                className={`rounded-md border p-2 ${row.validationError ? "border-danger/60 bg-danger/5" : "border-border bg-off-white"}`}
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <FormField label="Item #">
                      <input
                      value={row.item_number}
                      onChange={(e) => updateRow(index, { item_number: e.target.value })}
                      className="mt-0.5 w-full rounded border border-border bg-surface px-1.5 py-1 text-xs"
                    />
                    </FormField>
                  </div>
                  <div>
                    <FormField label="Evidence type">
                      <input
                      value={row.evidence_type}
                      onChange={(e) => updateRow(index, { evidence_type: e.target.value })}
                      className="mt-0.5 w-full rounded border border-border bg-surface px-1.5 py-1 text-xs"
                    />
                    </FormField>
                  </div>
                  <div className="col-span-2">
                    <FormField label="Description">
                      <input
                      value={row.description}
                      onChange={(e) => updateRow(index, { description: e.target.value })}
                      className="mt-0.5 w-full rounded border border-border bg-surface px-1.5 py-1 text-xs"
                    />
                    </FormField>
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <FormField label="Acceptance criteria">
                      <input
                      value={row.acceptance_criteria}
                      onChange={(e) => updateRow(index, { acceptance_criteria: e.target.value })}
                      className="mt-0.5 w-full rounded border border-border bg-surface px-1.5 py-1 text-xs"
                    />
                    </FormField>
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <label className="flex items-center gap-1 text-xs text-ink">
                      <input
                        type="checkbox"
                        checked={row.is_mandatory}
                        onChange={(e) => updateRow(index, { is_mandatory: e.target.checked })}
                        className="h-3 w-3"
                      />
                      <Tx>Mandatory</Tx>
                    </label>
                    <Button type="button" onClick={() => removeRow(index)} variant="link-danger" size="sm">
                      <Tx>Remove</Tx>
                    </Button>
                  </div>
                </div>
                {row.validationError && <p role="alert" className="mt-1 text-xs text-danger">{row.validationError}</p>}
              </div>
            ))}
            {rows.length === 0 && <p className="text-xs text-muted"><Tx>Every parsed row has been removed.</Tx></p>}
          </div>

          {commitState.error && <p role="alert" className="text-xs text-danger">{commitState.error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={commitPending || rows.length === 0 || invalidCount > 0}>
              {commitPending ? "Importing…" : `Import ${rows.length} item${rows.length === 1 ? "" : "s"}`}
            </Button>
            <Button type="button" onClick={() => setRows(null)} variant="link-muted" size="sm">
              <Tx>Discard and re-upload</Tx>
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
