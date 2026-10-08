"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";

export interface ExtractFieldConfig {
  key: string;
  label: string;
}

export interface ExtractState {
  error: string | null;
  rows: Record<string, string | null>[];
  aiLogId: string | null;
}

export interface AddState {
  error: string | null;
  addedCount: number;
}

/**
 * Shared "extract with AI, review every row, add the confirmed ones" panel for all three
 * registers (calibration/welder/material) — the register-extraction workflow from the client's
 * sample pack. Generic over the row shape (a flat Record<string, string | null>) since all three
 * extracted row types are just a handful of text/date fields; the caller supplies which fields to
 * show and in what order via `fields`.
 *
 * Nothing here writes to the database directly — `extractAction` only returns draft rows (see
 * lib/registers/actions.ts's extractCalibrationRowsAction &c.), and `addAction` (the only thing
 * that persists anything) receives whatever is actually left in the editable table below at
 * submit time, so a row the reviewer edited or removed is exactly what gets added or dropped.
 */
export function ExtractRegisterPanel({
  projectId,
  title,
  description,
  placeholder,
  fields,
  extractAction,
  addAction,
}: {
  projectId: string;
  title: string;
  description: string;
  placeholder: string;
  fields: ExtractFieldConfig[];
  extractAction: (state: ExtractState, formData: FormData) => Promise<ExtractState>;
  addAction: (state: AddState, formData: FormData) => Promise<AddState>;
}) {
  const extractInitialState: ExtractState = { error: null, rows: [], aiLogId: null };
  const addInitialState: AddState = { error: null, addedCount: 0 };

  const [extractState, extractFormAction, extractPending] = useActionState(extractAction, extractInitialState);
  const [addState, addFormAction, addPending] = useActionState(addAction, addInitialState);
  const [sourceText, setSourceText] = useState("");
  const [rows, setRows] = useState<Record<string, string | null>[] | null>(null);
  const [aiLogId, setAiLogId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [appliedExtractState, setAppliedExtractState] = useState(extractState);
  if (extractState !== appliedExtractState) {
    setAppliedExtractState(extractState);
    if (extractState.rows.length > 0) {
      setRows(extractState.rows);
      setAiLogId(extractState.aiLogId);
    }
  }

  function updateField(rowIdx: number, key: string, value: string) {
    setRows((prev) => {
      if (!prev) return prev;
      return prev.map((row, i) => (i === rowIdx ? { ...row, [key]: value || null } : row));
    });
  }

  function removeRow(rowIdx: number) {
    setRows((prev) => (prev ? prev.filter((_, i) => i !== rowIdx) : prev));
  }

  // A successful add clears the reviewed rows so the panel resets to "extract again" — the newly
  // added rows now show up in the register table below via the action's own revalidatePath.
  const [appliedAddState, setAppliedAddState] = useState(addState);
  if (addState !== appliedAddState) {
    setAppliedAddState(addState);
    if (addState.addedCount > 0) {
      setRows(null);
      setAiLogId(null);
      setSourceText("");
      setOpen(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-border bg-off-white p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-burgundy hover:underline"
      >
        {open ? "▾" : "▸"} Extract from document text (AI-assisted)
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted">{description}</p>

          {!rows && (
            <form action={extractFormAction} className="space-y-2">
              <input type="hidden" name="project_id" value={projectId} />
              <textarea
                name="source_text"
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                rows={5}
                placeholder={placeholder}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs outline-none focus:border-burgundy"
              />
              <p className="text-xs text-muted">
                Paste the certificate/document text (or the vault document&apos;s extracted text). A
                missing field stays blank — the AI never guesses a date, number, or range it can&apos;t
                actually find; you confirm every row below before anything is added.
              </p>
              {extractState.error && <p role="alert" className="text-xs text-danger">{extractState.error}</p>}
              <Button type="submit" size="sm" disabled={extractPending || !sourceText.trim()}>
                {extractPending ? "Extracting…" : "Extract rows"}
              </Button>
            </form>
          )}

          {rows && (
            <form action={addFormAction} className="space-y-3">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="ai_log_id" value={aiLogId ?? ""} />
              <input type="hidden" name="rows_json" value={JSON.stringify(rows)} readOnly />

              <p className="text-xs font-medium text-ink">
                {rows.length} extracted row{rows.length === 1 ? "" : "s"} — review and edit before adding
              </p>

              <div className="space-y-2">
                {rows.map((row, rowIdx) => (
                  <div key={rowIdx} className="rounded-md border border-border bg-surface p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                        {fields.map((field) => (
                          <div key={field.key}>
                            <FormField label={<>{field.label}</>}>
                              <input
                              value={row[field.key] ?? ""}
                              onChange={(e) => updateField(rowIdx, field.key, e.target.value)}
                              placeholder="—"
                              className="mt-0.5 w-full rounded border border-border bg-off-white px-1.5 py-1 text-xs"
                            />
                            </FormField>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeRow(rowIdx)}
                        className="text-xs font-medium text-danger hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                {rows.length === 0 && <p className="text-xs text-muted">Every extracted row has been removed.</p>}
              </div>

              {addState.error && <p role="alert" className="text-xs text-danger">{addState.error}</p>}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={addPending || rows.length === 0}>
                  {addPending ? "Adding…" : `Add ${rows.length} row${rows.length === 1 ? "" : "s"}`}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setRows(null);
                    setAiLogId(null);
                  }}
                  className="text-xs text-muted hover:underline"
                >
                  Discard and re-extract
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
