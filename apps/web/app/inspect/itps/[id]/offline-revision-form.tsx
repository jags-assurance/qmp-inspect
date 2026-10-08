"use client";

import { useActionState, useRef, useState } from "react";
import {
  applyOfflineItpRevisionAction,
  parseOfflineItpUploadAction,
  type ApplyOfflineRevisionState,
  type ParseOfflineUploadState,
} from "@/lib/itps/offline-revision-actions";
import { Button } from "@/components/ui/button";

const parseInitialState: ParseOfflineUploadState = { error: null, itpId: null, rowsJson: null, diff: null };
const applyInitialState: ApplyOfflineRevisionState = { error: null, success: false };

/**
 * R41 — the re-upload half of the offline round-trip: "Download for offline editing" (the export
 * link next to this form on the page) produces the .xlsx this form reads back in. Two steps, same
 * shape as NewItpFromAiForm's generate -> review -> confirm: upload -> preview diff -> confirm with a
 * reason. Nothing is written to the database until the reviewer explicitly confirms the second step
 * (see lib/itps/offline-revision-actions.ts).
 */
export function OfflineRevisionForm({ itpId }: { itpId: string }) {
  const [parseState, parseFormAction, parsePending] = useActionState(parseOfflineItpUploadAction, parseInitialState);
  const [applyState, applyFormAction, applyPending] = useActionState(applyOfflineItpRevisionAction, applyInitialState);
  const [reason, setReason] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  // Cleared locally once applyState.success comes back, so the panel resets for the next upload
  // rather than re-showing a diff that's already been applied.
  const [dismissed, setDismissed] = useState(false);
  const showDiff = parseState.diff && !dismissed && !applyState.success;

  function reset() {
    setDismissed(true);
    setReason("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    setOpen(false);
  }

  if (!open && !showDiff) {
    return (
      <button
        type="button"
        onClick={() => {
          setDismissed(false);
          setOpen(true);
        }}
        className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
      >
        Re-upload edited file…
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Re-upload offline-edited file</h2>
        <button type="button" onClick={reset} className="text-xs font-medium text-muted hover:underline">
          Cancel
        </button>
      </div>

      {!showDiff && (
        <form
          action={(formData) => {
            setDismissed(false);
            formData.set("itp_id", itpId);
            parseFormAction(formData);
          }}
          className="mt-3 space-y-3"
        >
          <p className="text-xs text-muted">
            Upload the edited .xlsx workbook (the same layout produced by &quot;Download for offline
            editing&quot;). You&apos;ll see exactly what changed before anything is applied.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            name="file"
            accept=".xlsx"
            required
            className="block w-full text-sm text-ink file:me-3 file:rounded-md file:border file:border-border file:bg-off-white file:px-3 file:py-1.5 file:text-xs file:font-medium"
          />
          {parseState.error && <p role="alert" className="text-sm text-danger">{parseState.error}</p>}
          <Button type="submit" disabled={parsePending}>
            {parsePending ? "Reading file…" : "Preview changes"}
          </Button>
        </form>
      )}

      {showDiff && parseState.diff && parseState.itpId && parseState.rowsJson && (
        <form action={applyFormAction} className="mt-3 space-y-4">
          <input type="hidden" name="itp_id" value={parseState.itpId} />
          <input type="hidden" name="rows_json" value={parseState.rowsJson} />
          <input type="hidden" name="base_token" value={parseState.baseToken ?? ""} />

          <div className="space-y-3 rounded-md border border-border bg-off-white p-3 text-xs">
            {parseState.diff.sectionsAdded.length > 0 && (
              <DiffGroup label="Sections added" tone="success">
                {parseState.diff.sectionsAdded.map((s) => (
                  <li key={`sa-${s.sectionNumber}`}>
                    {s.sectionNumber}. {s.title}
                  </li>
                ))}
              </DiffGroup>
            )}
            {parseState.diff.sectionsRemoved.length > 0 && (
              <DiffGroup label="Sections removed" tone="danger">
                {parseState.diff.sectionsRemoved.map((s) => (
                  <li key={`sr-${s.sectionNumber}`}>
                    {s.sectionNumber}. {s.title}
                  </li>
                ))}
              </DiffGroup>
            )}
            {parseState.diff.itemsAdded.length > 0 && (
              <DiffGroup label="Activities added" tone="success">
                {parseState.diff.itemsAdded.map((r) => (
                  <li key={`ia-${r.sectionNumber}-${r.itemNumber}`}>
                    <span className="doc-id">{r.itemNumber}</span> {r.activity}
                  </li>
                ))}
              </DiffGroup>
            )}
            {parseState.diff.itemsRemoved.length > 0 && (
              <DiffGroup label="Activities removed" tone="danger">
                {parseState.diff.itemsRemoved.map((r) => (
                  <li key={`ir-${r.sectionNumber}-${r.itemNumber}`}>
                    <span className="doc-id">{r.itemNumber}</span> {r.activity}
                  </li>
                ))}
              </DiffGroup>
            )}
            {parseState.diff.itemsChanged.length > 0 && (
              <DiffGroup label="Changed" tone="warning">
                {parseState.diff.itemsChanged.map((c, i) => (
                  <li key={`ic-${c.sectionNumber}-${c.itemNumber}-${i}`}>
                    <span className="doc-id">{c.itemNumber}</span> {c.field}: &quot;{c.before || "—"}&quot; →{" "}
                    &quot;{c.after || "—"}&quot;
                  </li>
                ))}
              </DiffGroup>
            )}
          </div>

          <div>
            <label htmlFor="offline_revision_reason" className="block text-xs font-medium text-ink">
              Reason for this revision <span className="text-danger">*</span>
            </label>
            <textarea
              id="offline_revision_reason"
              name="reason"
              required
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. &quot;Marked up offline by site engineer — added weld inspection step and corrected acceptance criteria on 2.3&quot;"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
            />
          </div>

          {applyState.error && <p role="alert" className="text-sm text-danger">{applyState.error}</p>}
          {applyState.success && (
            <p className="text-sm text-success">Applied — a new revision has been created from the uploaded file.</p>
          )}

          <div className="flex gap-3">
            <Button type="submit" disabled={applyPending || !reason.trim()}>
              {applyPending ? "Applying…" : "Apply as new revision"}
            </Button>
            <button type="button" onClick={reset} className="rounded-md border border-border px-3 py-2 text-sm text-ink hover:bg-off-white">
              Discard
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function DiffGroup({ label, tone, children }: { label: string; tone: "success" | "danger" | "warning"; children: React.ReactNode }) {
  const toneClass = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-warning";
  return (
    <div>
      <p className={`font-medium ${toneClass}`}>{label}</p>
      <ul className="mt-1 space-y-0.5 ps-3 text-ink">{children}</ul>
    </div>
  );
}
