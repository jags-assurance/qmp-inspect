"use client";

import { useActionState, useState } from "react";
import {
  addItpItemMeasurementAction,
  updateItpItemMeasurementAction,
  deleteItpItemMeasurementAction,
  linkItpItemEvidenceDocumentAction,
  unlinkItpItemEvidenceDocumentAction,
  type ItpItemMeasurementRow,
  type ItpItemEvidenceDocumentRow,
  type EvidenceActionState,
} from "@/lib/itps/evidence-actions";
import { Button } from "@/components/ui/button";
import type { VaultDocumentOption } from "./expected-record-form";

const initialState: EvidenceActionState = { error: null };

/**
 * evidence_type=3 ("Measurement record") field-execution — one flat row per measurement, mirroring
 * standalone_assignment_measurements' proven shape/UI (same "add a row, pick pass/fail" pattern
 * this app already ships elsewhere — see AddMeasurementForm on the standalone assignment page —
 * rather than a new one). See lib/itps/evidence-actions.ts for the "who may record" gate.
 */
export function ItpItemMeasurementsSection({
  itpItemId,
  measurements,
  canRecord,
}: {
  itpItemId: string;
  measurements: ItpItemMeasurementRow[];
  canRecord: boolean;
}) {
  return (
    <div className="border-t border-border px-3 py-3">
      <h4 className="text-xs font-medium text-muted">Measurements</h4>
      {measurements.length > 0 ? (
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-muted">
              <th className="pb-1 pr-2 font-medium">Description</th>
              <th className="pb-1 pr-2 font-medium">Nominal</th>
              <th className="pb-1 pr-2 font-medium">Tolerance</th>
              <th className="pb-1 pr-2 font-medium">Actual</th>
              <th className="pb-1 pr-2 font-medium">Unit</th>
              <th className="pb-1 pr-2 font-medium">Result</th>
              {canRecord && <th className="pb-1" />}
            </tr>
          </thead>
          <tbody>
            {measurements.map((m) => (
              <MeasurementRow key={m.id} itpItemId={itpItemId} measurement={m} canDelete={canRecord} />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-1.5 text-xs text-muted">No measurements recorded yet.</p>
      )}
      {canRecord && <AddMeasurementForm itpItemId={itpItemId} />}
    </div>
  );
}

function MeasurementRow({
  itpItemId,
  measurement,
  canDelete,
}: {
  itpItemId: string;
  measurement: ItpItemMeasurementRow;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateItpItemMeasurementAction, initialState);

  if (editing) {
    return (
      <tr className="border-t border-border/60 bg-off-white">
        <td colSpan={canDelete ? 7 : 6} className="py-1.5">
          <form action={formAction} className="flex flex-wrap items-center gap-1.5 px-1">
            <input type="hidden" name="itp_item_id" value={itpItemId} />
            <input type="hidden" name="measurement_id" value={measurement.id} />
            <input
              name="description"
              required
              defaultValue={measurement.description}
              placeholder="What's being measured"
              className="min-w-[8rem] flex-1 rounded border border-border bg-surface px-2 py-1"
            />
            <input
              name="nominal_value"
              defaultValue={measurement.nominal_value ?? ""}
              placeholder="Nominal e.g. 12.0"
              className="w-24 rounded border border-border bg-surface px-2 py-1"
            />
            <input
              name="tolerance"
              defaultValue={measurement.tolerance ?? ""}
              placeholder="Tolerance e.g. ±0.5"
              className="w-24 rounded border border-border bg-surface px-2 py-1"
            />
            <input
              name="actual_value"
              defaultValue={measurement.actual_value ?? ""}
              placeholder="Actual e.g. 11.8"
              className="w-24 rounded border border-border bg-surface px-2 py-1"
            />
            <input name="unit" defaultValue={measurement.unit ?? ""} placeholder="mm" className="w-14 rounded border border-border bg-surface px-2 py-1" />
            <select name="result" defaultValue={measurement.result ?? ""} className="rounded border border-border bg-surface px-2 py-1">
              <option value="">No result yet</option>
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
            </select>
            {state.error && <p className="w-full text-danger">{state.error}</p>}
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <button type="button" onClick={() => setEditing(false)} className="text-muted hover:underline">
              Cancel
            </button>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-border/60">
      <td className="py-1 pr-2 text-ink">{measurement.description}</td>
      <td className="py-1 pr-2 text-muted">{measurement.nominal_value ?? "—"}</td>
      <td className="py-1 pr-2 text-muted">{measurement.tolerance ?? "—"}</td>
      <td className="py-1 pr-2 text-muted">{measurement.actual_value ?? "—"}</td>
      <td className="py-1 pr-2 text-muted">{measurement.unit ?? "—"}</td>
      <td className="py-1 pr-2">
        {measurement.result ? (
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
              measurement.result === "pass" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
            }`}
          >
            {measurement.result === "pass" ? "Pass" : "Fail"}
          </span>
        ) : (
          <span className="text-[10px] text-muted">—</span>
        )}
      </td>
      {canDelete && (
        <td className="py-1 text-right whitespace-nowrap">
          <button type="button" onClick={() => setEditing(true)} className="text-[10px] text-burgundy hover:underline">
            Edit
          </button>
          <form action={deleteItpItemMeasurementAction} className="inline">
            <input type="hidden" name="itp_item_id" value={itpItemId} />
            <input type="hidden" name="measurement_id" value={measurement.id} />
            <button type="submit" className="ml-2 text-[10px] text-danger hover:underline">
              Remove
            </button>
          </form>
        </td>
      )}
    </tr>
  );
}

function AddMeasurementForm({ itpItemId }: { itpItemId: string }) {
  const [state, formAction, pending] = useActionState(addItpItemMeasurementAction, initialState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 text-xs font-medium text-burgundy hover:underline">
        + Record measurement
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-2 space-y-1.5 rounded border border-border bg-off-white p-2 text-xs">
      <input type="hidden" name="itp_item_id" value={itpItemId} />
      <input
        name="description"
        required
        placeholder="What's being measured"
        className="w-full rounded border border-border bg-surface px-2 py-1"
      />
      <div className="flex gap-1.5">
        <input name="nominal_value" placeholder="Nominal e.g. 12.0" className="flex-1 rounded border border-border bg-surface px-2 py-1" />
        <input name="tolerance" placeholder="Tolerance e.g. ±0.5" className="flex-1 rounded border border-border bg-surface px-2 py-1" />
        <input name="actual_value" placeholder="Actual e.g. 11.8" className="flex-1 rounded border border-border bg-surface px-2 py-1" />
        <input name="unit" placeholder="mm" className="w-16 rounded border border-border bg-surface px-2 py-1" />
      </div>
      <select name="result" defaultValue="" className="rounded border border-border bg-surface px-2 py-1">
        <option value="">No result yet</option>
        <option value="pass">Pass</option>
        <option value="fail">Fail</option>
      </select>
      {state.error && <p className="text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="text-muted hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * evidence_type=2 ("Document upload") field-execution — links existing vault documents as this
 * activity's own completion evidence. Deliberately reuses the project's Vault (upload there first)
 * rather than a second upload UI here, the same "attach from vault" pattern
 * ExpectedRecordsSection's MarkReceivedForm already offers — a document-upload activity's evidence
 * should be a controlled vault document with its own revision history, not a one-off file.
 */
const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  for_review: { label: "For review", className: "bg-warning/10 text-warning" },
  superseded: { label: "Superseded", className: "bg-danger/10 text-danger" },
};

export function ItpItemEvidenceDocumentsSection({
  itpItemId,
  documents,
  vaultDocuments,
  canLink,
}: {
  itpItemId: string;
  documents: (ItpItemEvidenceDocumentRow & { title: string; documentReference: string | null; status: string | null })[];
  vaultDocuments: VaultDocumentOption[];
  canLink: boolean;
}) {
  const linkedIds = new Set(documents.map((d) => d.vault_document_id));
  // Only an approved, current document satisfies this activity's evidence requirement — a document
  // still "for review" or already superseded by a newer revision can't be picked, matching the
  // server-side check in linkItpItemEvidenceDocumentAction (this is the UX-level mirror of that
  // check, not the enforcement itself — see that action's own comment).
  const availableDocuments = vaultDocuments.filter((d) => !linkedIds.has(d.id) && d.status === "approved");
  const hasUnlinkedNonApproved = vaultDocuments.some((d) => !linkedIds.has(d.id) && d.status !== "approved");

  return (
    <div className="border-t border-border px-3 py-3">
      <h4 className="text-xs font-medium text-muted">Evidence documents</h4>
      <ul className="mt-2 space-y-1.5">
        {documents.map((doc) => {
          const badge = doc.status ? STATUS_BADGE[doc.status] : undefined;
          return (
            <li key={doc.id} className="flex items-center justify-between rounded border border-border px-2 py-1.5 text-xs">
              <span className="text-ink">
                {doc.title}
                {doc.documentReference && <span className="text-muted"> ({doc.documentReference})</span>}
                {badge && <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>{badge.label}</span>}
              </span>
              {canLink && (
                <form action={unlinkItpItemEvidenceDocumentAction}>
                  <input type="hidden" name="itp_item_id" value={itpItemId} />
                  <input type="hidden" name="link_id" value={doc.id} />
                  <button type="submit" className="text-danger hover:underline">
                    Unlink
                  </button>
                </form>
              )}
            </li>
          );
        })}
        {documents.length === 0 && <li className="text-xs text-muted">No evidence document linked yet.</li>}
      </ul>
      {canLink && <LinkDocumentForm itpItemId={itpItemId} availableDocuments={availableDocuments} hasUnlinkedNonApproved={hasUnlinkedNonApproved} />}
    </div>
  );
}

function LinkDocumentForm({
  itpItemId,
  availableDocuments,
  hasUnlinkedNonApproved,
}: {
  itpItemId: string;
  availableDocuments: VaultDocumentOption[];
  hasUnlinkedNonApproved: boolean;
}) {
  const [state, formAction, pending] = useActionState(linkItpItemEvidenceDocumentAction, initialState);
  const [open, setOpen] = useState(false);

  if (availableDocuments.length === 0) {
    return (
      <p className="mt-2 text-[11px] text-muted">
        {hasUnlinkedNonApproved
          ? "There's an unapproved or superseded document in the vault, but only an approved, current document can be linked as evidence — get it approved first (Document Vault → Approve)."
          : "Upload the evidence document to the project's Document Vault first, then link it here."}
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 text-xs font-medium text-burgundy hover:underline">
        + Link evidence document
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-2 space-y-1.5 rounded border border-border bg-off-white p-2 text-xs">
      <input type="hidden" name="itp_item_id" value={itpItemId} />
      <select name="vault_document_id" required defaultValue="" className="w-full rounded border border-border bg-surface px-2 py-1">
        <option value="">Select a document from the vault…</option>
        {availableDocuments.map((doc) => (
          <option key={doc.id} value={doc.id}>
            {doc.folderName} — {doc.title}
            {doc.documentReference ? ` (${doc.documentReference})` : ""}
          </option>
        ))}
      </select>
      {state.error && <p className="text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Linking…" : "Link"}
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="text-muted hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
