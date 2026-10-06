"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  deleteRegisterEntryAction,
  updateRegisterEntryAction,
  type ManageRegisterState,
  type RegisterKind,
} from "@/lib/registers/manage-actions";
import { daysUntil, describeDays } from "@/lib/registers/status";
import { MATERIAL_APPROVAL_STATUS_LABELS, MATERIAL_RECEIPT_STATUS_LABELS } from "@/lib/registers/types";

/** A due / expiry date with how far away it is, coloured by urgency (red past due, amber inside the warning window). */
export function ExpiryDate({ date, warnWithinDays }: { date: string; warnWithinDays: number }) {
  const days = daysUntil(date);
  const tone = days < 0 ? "text-danger font-medium" : days <= warnWithinDays ? "text-warning font-medium" : "text-ink";
  return (
    <span>
      <span className={tone}>{new Date(date).toLocaleDateString("en-GB")}</span>
      <span className={`block text-xs ${days < 0 ? "text-danger" : "text-muted"}`}>{describeDays(days)}</span>
    </span>
  );
}

/** Link to the entry's attached certificate (opened through a signed URL), or an em dash when none. */
export function CertificateLink({ kind, id, hasFile }: { kind: RegisterKind; id: string; hasFile: boolean }) {
  if (!hasFile) return <span className="text-muted">—</span>;
  return (
    <a href={`/api/registers/certificate?kind=${kind}&id=${id}`} target="_blank" rel="noreferrer" className="text-sm text-burgundy hover:underline">
      View
    </a>
  );
}

interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "date" | "textarea" | "select";
  required?: boolean;
  options?: { value: string; label: string }[];
  wide?: boolean;
}

const APPROVAL_OPTIONS = Object.entries(MATERIAL_APPROVAL_STATUS_LABELS).map(([value, label]) => ({ value, label: `${value} — ${label}` }));
const RECEIPT_OPTIONS = Object.entries(MATERIAL_RECEIPT_STATUS_LABELS).map(([value, label]) => ({ value, label }));

const FIELDS: Record<RegisterKind, FieldDef[]> = {
  calibration: [
    { name: "instrument_name", label: "Instrument", required: true },
    { name: "instrument_tag", label: "Instrument ID / tag" },
    { name: "cert_number", label: "Cert number", required: true },
    { name: "calibration_lab", label: "Calibration lab" },
    { name: "cal_date", label: "Calibration date", type: "date" },
    { name: "due_date", label: "Due date", type: "date", required: true },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ],
  welder: [
    { name: "welder_identifier", label: "Welder ID / name", required: true },
    { name: "wpq_number", label: "WPQ record no." },
    { name: "process", label: "Process (e.g. GTAW)" },
    { name: "position", label: "Position (e.g. 6G)" },
    { name: "qualified_wps", label: "Qualified WPS", required: true },
    { name: "qualified_ranges", label: "Qualified range / continuity" },
    { name: "expiry_date", label: "Expiry date", type: "date", required: true },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ],
  material: [
    { name: "material_description", label: "Material", required: true, wide: true },
    { name: "submittal_reference", label: "Submittal ref." },
    { name: "approval_status", label: "Approval", type: "select", options: APPROVAL_OPTIONS, required: true },
    { name: "approved_date", label: "Approved date", type: "date" },
    { name: "heat_number", label: "Heat number" },
    { name: "batch_number", label: "Batch number" },
    { name: "po_reference", label: "PO reference" },
    { name: "supplier", label: "Supplier" },
    { name: "quantity", label: "Quantity" },
    { name: "certificate_reference", label: "CoC / MTC reference" },
    { name: "receipt_status", label: "Receiving status", type: "select", options: RECEIPT_OPTIONS, required: true },
    { name: "disposition_notes", label: "Disposition note (required if quarantined / on hold)", type: "textarea", wide: true },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ],
  personnel: [
    { name: "certification_type", label: "Certification", required: true },
    { name: "cert_number", label: "Certificate number" },
    { name: "issued_date", label: "Issued", type: "date" },
    { name: "expiry_date", label: "Expiry date", type: "date", required: true },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ],
};

const KIND_TITLE: Record<RegisterKind, string> = {
  calibration: "Edit calibration entry",
  welder: "Edit welder qualification",
  material: "Edit material entry",
  personnel: "Edit personnel certification",
};

const initialState: ManageRegisterState = { error: null };
const INPUT = "mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy";

function EditDialog({ kind, projectId, row, onClose }: { kind: RegisterKind; projectId: string; row: Record<string, string | null>; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(updateRegisterEntryAction, initialState);
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current && !pending && state.error === null) onClose();
  }, [pending, state, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={KIND_TITLE[kind]}>
      <form
        action={formAction}
        onSubmit={() => (submitted.current = true)}
        className="mt-10 w-full max-w-2xl space-y-3 rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <h3 className="text-base font-semibold text-ink">{KIND_TITLE[kind]}</h3>
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={row.id ?? ""} />
        <input type="hidden" name="project_id" value={projectId} />
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS[kind].map((field) => (
            <div key={field.name} className={field.wide ? "sm:col-span-2" : undefined}>
              <label htmlFor={`edit-${field.name}`} className="block text-xs font-medium text-ink">
                {field.label}
              </label>
              {field.type === "textarea" ? (
                <textarea id={`edit-${field.name}`} name={field.name} rows={2} defaultValue={row[field.name] ?? ""} className={INPUT} />
              ) : field.type === "select" ? (
                <select id={`edit-${field.name}`} name={field.name} required={field.required} defaultValue={row[field.name] ?? ""} className={INPUT}>
                  {field.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`edit-${field.name}`}
                  name={field.name}
                  type={field.type ?? "text"}
                  required={field.required}
                  defaultValue={(field.type === "date" ? (row[field.name] ?? "").slice(0, 10) : row[field.name]) ?? ""}
                  className={INPUT}
                />
              )}
            </div>
          ))}
        </div>
        {kind === "material" && (
          <p className="text-xs text-muted">Setting the receiving status to “Released” releases the material for use; who released it and when is recorded.</p>
        )}
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className="rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark disabled:opacity-50">
            {pending ? "Saving…" : "Save changes"}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-muted hover:underline">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/** Edit / Delete (and, for materials, a one-click Release) for one register row. JAGS staff only — rendered only when `canManage`. */
export function RegisterRowActions({
  kind,
  projectId,
  row,
}: {
  kind: RegisterKind;
  projectId: string;
  row: Record<string, string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [deleteState, deleteAction, deleting] = useActionState(deleteRegisterEntryAction, initialState);
  const [releaseState, releaseAction, releasing] = useActionState(updateRegisterEntryAction, initialState);
  const canQuickRelease = kind === "material" && row.receipt_status !== "released" && row.receipt_status !== "on_hold" && (row.approval_status === "A" || row.approval_status === "B");

  return (
    <div className="flex flex-wrap items-center gap-2 whitespace-nowrap">
      {canQuickRelease && (
        <form action={releaseAction}>
          {Object.entries(row).map(([key, value]) => (key === "receipt_status" ? null : <input key={key} type="hidden" name={key} value={value ?? ""} />))}
          <input type="hidden" name="kind" value="material" />
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="receipt_status" value="released" />
          <button type="submit" disabled={releasing} className="rounded border border-border px-2 py-0.5 text-xs font-medium text-success hover:bg-off-white disabled:opacity-50">
            {releasing ? "Releasing…" : "Release"}
          </button>
        </form>
      )}
      <button type="button" onClick={() => setEditing(true)} className="text-xs text-burgundy hover:underline">
        Edit
      </button>
      <form
        action={deleteAction}
        onSubmit={(e) => {
          if (!confirm("Delete this entry? This can't be undone.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={row.id ?? ""} />
        <input type="hidden" name="project_id" value={projectId} />
        <button type="submit" disabled={deleting} className="text-xs text-danger hover:underline disabled:opacity-50">
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </form>
      {(deleteState.error || releaseState.error) && <span className="block max-w-xs whitespace-normal text-xs text-danger">{deleteState.error ?? releaseState.error}</span>}
      {editing && <EditDialog kind={kind} projectId={projectId} row={row} onClose={() => setEditing(false)} />}
    </div>
  );
}
