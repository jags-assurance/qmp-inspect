"use client";

import { useActionState } from "react";
import {
  recalibrateInstrumentAction,
  setRegisterLifecycleAction,
  verifyRegisterEntryAction,
  type ManageRegisterState,
  type RegisterKind,
} from "@/lib/registers/manage-actions";
import { LIFECYCLE_LABELS } from "@/lib/registers/lifecycle";
import { CertificateUpload } from "./certificate-upload";

const initialState: ManageRegisterState = { error: null };
const INPUT = "mt-1 w-full rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy";

/** "Awaiting verification" / "Superseded" / "Retired" markers shown next to a register row's status. */
export function RegisterRowFlags({ verifiedAt, lifecycleStatus }: { verifiedAt?: string | null; lifecycleStatus?: string | null }) {
  const inactive = lifecycleStatus && lifecycleStatus !== "active";
  // verifiedAt undefined = the column isn't deployed yet: show nothing rather than a false warning.
  const unverified = verifiedAt === null;
  if (!inactive && !unverified) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {unverified && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-ink">Awaiting JAGS verification</span>}
      {inactive && (
        <span className="rounded-full bg-muted/15 px-2 py-0.5 text-[11px] font-medium text-muted">
          {LIFECYCLE_LABELS[lifecycleStatus as keyof typeof LIFECYCLE_LABELS] ?? lifecycleStatus}
        </span>
      )}
    </span>
  );
}

/** Verify / retire / (calibration) recalibrate controls for one register row. JAGS staff only. */
export function RegisterLifecycleActions({
  kind,
  projectId,
  id,
  verifiedAt,
  lifecycleStatus,
}: {
  kind: RegisterKind;
  projectId: string;
  id: string;
  verifiedAt?: string | null;
  lifecycleStatus?: string | null;
}) {
  const [verifyState, verifyAction, verifying] = useActionState(verifyRegisterEntryAction, initialState);
  const [lifeState, lifeAction, changing] = useActionState(setRegisterLifecycleAction, initialState);
  const [recalState, recalAction, recalibrating] = useActionState(recalibrateInstrumentAction, initialState);
  const inactive = !!lifecycleStatus && lifecycleStatus !== "active";
  const unverified = verifiedAt === null;

  return (
    <div className="flex flex-wrap items-start gap-2">
      {unverified && (
        <form action={verifyAction}>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="project_id" value={projectId} />
          <button type="submit" disabled={verifying} className="rounded border border-border px-2 py-0.5 text-xs font-medium text-success hover:bg-off-white disabled:opacity-50">
            {verifying ? "Verifying…" : "Verify"}
          </button>
        </form>
      )}

      {kind === "calibration" && !inactive && (
        <details className="relative">
          <summary className="cursor-pointer text-xs text-burgundy hover:underline">Recalibrate</summary>
          <form action={recalAction} className="mt-1 w-72 space-y-2 rounded-md border border-border bg-surface p-3 shadow-md">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="project_id" value={projectId} />
            <p className="text-xs text-muted">Keeps the old certificate on record and adds the new one, so earlier inspections stay traceable.</p>
            <label className="block text-xs font-medium text-ink">
              New certificate number
              <input name="cert_number" required className={INPUT} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-medium text-ink">
                Calibrated
                <input name="cal_date" type="date" required className={INPUT} />
              </label>
              <label className="block text-xs font-medium text-ink">
                Next due
                <input name="due_date" type="date" required className={INPUT} />
              </label>
            </div>
            <label className="block text-xs font-medium text-ink">
              As-found result (previous cycle)
              <select name="as_found_result" defaultValue="not_recorded" className={INPUT}>
                <option value="not_recorded">Not recorded</option>
                <option value="in_tolerance">In tolerance</option>
                <option value="out_of_tolerance">Out of tolerance</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-ink">
              As-found notes (required if out of tolerance)
              <textarea name="as_found_notes" rows={2} className={INPUT} />
            </label>
            <CertificateUpload projectId={projectId} kind="calibration" label="New certificate (optional)" />
            {recalState.error && <p className="text-xs text-danger">{recalState.error}</p>}
            <button type="submit" disabled={recalibrating} className="rounded-md bg-burgundy px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
              {recalibrating ? "Saving…" : "Record recalibration"}
            </button>
          </form>
        </details>
      )}

      <details className="relative">
        <summary className="cursor-pointer text-xs text-muted hover:underline">{inactive ? "Reactivate" : "Retire"}</summary>
        <form action={lifeAction} className="mt-1 w-64 space-y-2 rounded-md border border-border bg-surface p-3 shadow-md">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="project_id" value={projectId} />
          {inactive ? (
            <input type="hidden" name="lifecycle_status" value="active" />
          ) : (
            <>
              <label className="block text-xs font-medium text-ink">
                Mark as
                <select name="lifecycle_status" defaultValue="retired" className={INPUT}>
                  <option value="retired">Retired (no longer used)</option>
                  <option value="superseded">Superseded (replaced)</option>
                  <option value="withdrawn">Withdrawn (entered in error / rejected)</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-ink">
                Reason
                <input name="reason" required className={INPUT} />
              </label>
            </>
          )}
          {lifeState.error && <p className="text-xs text-danger">{lifeState.error}</p>}
          <button type="submit" disabled={changing} className="rounded-md border border-border px-3 py-1 text-xs font-medium text-ink disabled:opacity-50">
            {changing ? "Saving…" : inactive ? "Reactivate entry" : "Retire entry"}
          </button>
        </form>
      </details>
      {verifyState.error && <span className="block max-w-xs text-xs text-danger">{verifyState.error}</span>}
    </div>
  );
}
