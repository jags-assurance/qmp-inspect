"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  deleteRegisterEntryAction,
  replaceRegisterCertificateAction,
  updateRegisterEntryAction,
  type ManageRegisterState,
  type RegisterKind,
} from "@/lib/registers/manage-actions";
import { daysUntil, describeDays } from "@/lib/registers/status";
import { RegisterLifecycleActions } from "./register-lifecycle-actions";
import { CertificateUpload } from "./certificate-upload";
import { MATERIAL_APPROVAL_STATUS_LABELS, MATERIAL_RECEIPT_STATUS_LABELS } from "@/lib/registers/types";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";

/** Formats a plain YYYY-MM-DD date as dd/mm/yyyy without the timezone shift `new Date("YYYY-MM-DD")` causes west of UTC. */
export function formatRegisterDate(date: string | null | undefined): string {
  if (!date) return "—";
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC" });
}

/** A due / expiry date with how far away it is, coloured by urgency (red past due, amber inside the warning window). */
export function ExpiryDate({ date, warnWithinDays }: { date: string; warnWithinDays: number }) {
  const days = daysUntil(date);
  const tone = days < 0 ? "text-danger font-medium" : days <= warnWithinDays ? "text-warning font-medium" : "text-ink";
  return (
    <span>
      <span className={tone}>{formatRegisterDate(date)}</span>
      <span className={`block text-xs ${days < 0 ? "text-danger" : "text-muted"}`}>{describeDays(days)}</span>
    </span>
  );
}

/** Link to the entry's attached certificate (opened through a signed URL), or an em dash when none. */
export function CertificateLink({ kind, id, hasFile }: { kind: RegisterKind; id: string; hasFile: boolean }) {
  if (!hasFile) return <span className="text-muted">—</span>;
  return (
    <a href={`/api/registers/certificate?kind=${kind}&id=${id}`} target="_blank" rel="noreferrer" className="text-sm text-burgundy hover:underline">
      <Tx>View</Tx>
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

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (submitted.current && !pending && state.error === null) onClose();
  }, [pending, state, onClose]);

  // Dialog basics: Escape closes, focus moves in on open, Tab stays inside, focus returns to the trigger on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    const focusables = () => Array.from(root?.querySelectorAll<HTMLElement>("input, select, textarea, button, a[href]") ?? []).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("type") !== "hidden");
    focusables()[0]?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
  }, []);

  return (
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={KIND_TITLE[kind]}>
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
        <CertificateUpload projectId={projectId} kind={kind} label="Attach or replace certificate (optional)" />
        {kind === "material" && (
          <p className="text-xs text-muted"><Tx>Setting the receiving status to “Released” releases the material for use; who released it and when is recorded.</Tx></p>
        )}
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending} >
            {pending ? "Saving…" : "Save changes"}
          </Button>
          <Button type="button" onClick={onClose} variant="link-muted">
            <Tx>Cancel</Tx>
          </Button>
        </div>
      </form>
    </div>
  );
}

/** S3-11: replace (or attach) just the certificate file of one entry; the previous file stays on record. */
function ReplaceCertificate({ kind, projectId, id, hasFile }: { kind: RegisterKind; projectId: string; id: string; hasFile: boolean }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(replaceRegisterCertificateAction, initialState);
  const [open, setOpen] = useState(false);
  const submitted = useRef(false);
  useEffect(() => {
    if (submitted.current && !pending && state.error === null) {
      submitted.current = false;
      setOpen(false);
    }
  }, [pending, state]);
  return (
    <span className="relative">
      <Button type="button" onClick={() => setOpen((o) => !o)} variant="link" size="sm">
        {hasFile ? "Replace file" : "Attach file"}
      </Button>
      {open && (
        <form
          action={formAction}
          onSubmit={() => (submitted.current = true)}
          className="absolute end-0 z-20 mt-1 w-72 space-y-2 whitespace-normal rounded-md border border-border bg-surface p-3 shadow-lg"
        >
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="project_id" value={projectId} />
          <CertificateUpload projectId={projectId} kind={kind} label={hasFile ? "New certificate file" : "Certificate file"} />
          {hasFile && (
            <label className="block text-xs font-medium text-ink">
              <Tx>Reason for replacing</Tx>
              <input name="reason" required minLength={5} className={INPUT} placeholder={tl("e.g. re-issued certificate")} />
            </label>
          )}
          {hasFile && <p className="text-xs text-muted"><Tx>The previous file is kept on record.</Tx></p>}
          {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending} size="sm">
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" onClick={() => setOpen(false)} variant="link-muted" size="sm">
              <Tx>Cancel</Tx>
            </Button>
          </div>
        </form>
      )}
    </span>
  );
}

/** Edit / Delete (and, for materials, a one-click Release) for one register row. JAGS staff only — rendered only when `canManage`. */
export function RegisterRowActions({
  kind,
  projectId,
  row,
  verifiedAt,
  lifecycleStatus,
  hasCertificate = false,
  visible = true,
  contributorOnly = false,
}: {
  /** Hidden for rows the viewer may not touch. */
  visible?: boolean;
  /** A contributor editing their own unverified entry: Edit and certificate replace only. */
  contributorOnly?: boolean;
  kind: RegisterKind;
  projectId: string;
  row: Record<string, string | null>;
  hasCertificate?: boolean;
  verifiedAt?: string | null;
  lifecycleStatus?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [deleteState, deleteAction, deleting] = useActionState(deleteRegisterEntryAction, initialState);
  const [releaseState, releaseAction, releasing] = useActionState(updateRegisterEntryAction, initialState);
  const { gateSubmit, dialog } = useConfirm();
  const canQuickRelease = !contributorOnly && kind === "material" && row.receipt_status !== "released" && row.receipt_status !== "on_hold" && (row.approval_status === "A" || row.approval_status === "B");

  if (!visible) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 whitespace-nowrap">
      {dialog}
      {canQuickRelease && (
        <form action={releaseAction}>
          {Object.entries(row).map(([key, value]) => (key === "receipt_status" ? null : <input key={key} type="hidden" name={key} value={value ?? ""} />))}
          <input type="hidden" name="kind" value="material" />
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="receipt_status" value="released" />
          <Button type="submit" disabled={releasing} variant="outline" size="sm">
            {releasing ? "Releasing…" : "Release"}
          </Button>
        </form>
      )}
      <Button type="button" onClick={() => setEditing(true)} variant="link" size="sm">
        <Tx>Edit</Tx>
      </Button>
      {row.id && <ReplaceCertificate kind={kind} projectId={projectId} id={row.id} hasFile={hasCertificate} />}
      {!contributorOnly && <form
        action={deleteAction}
        onSubmit={gateSubmit({
          title: "Delete this entry?",
          message: "This can't be undone.",
          confirmLabel: "Delete",
          destructive: true,
        })}
      >
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={row.id ?? ""} />
        <input type="hidden" name="project_id" value={projectId} />
        <Button type="submit" disabled={deleting} variant="link-danger" size="sm">
          {deleting ? "Deleting…" : "Delete"}
        </Button>
      </form>}
      {!contributorOnly && row.id && <RegisterLifecycleActions kind={kind} projectId={projectId} id={row.id} verifiedAt={verifiedAt} lifecycleStatus={lifecycleStatus} />}
      {(deleteState.error || releaseState.error) && <span className="block max-w-xs whitespace-normal text-xs text-danger">{deleteState.error ?? releaseState.error}</span>}
      {editing && <EditDialog kind={kind} projectId={projectId} row={row} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** Every non-essential field of a register row behind one small "Details" toggle (same look as the ITP activity details). */
export function RegisterDetails({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-off-white [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
        <Tx>Details</Tx>
      </summary>
      <dl className="mt-1.5 max-w-prose space-y-1 text-xs text-muted">
        {items.map(({ label, value }) => (
          <div key={label}>
            <dt className="inline font-medium text-ink"><Tx>{label}</Tx>: </dt>
            <dd className="inline [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
