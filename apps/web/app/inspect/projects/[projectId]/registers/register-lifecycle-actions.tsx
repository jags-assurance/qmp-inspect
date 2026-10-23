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
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

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
      {unverified && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-ink"><Tx>Awaiting JAGS verification</Tx></span>}
      {inactive && (
        <span className="rounded-full bg-muted/15 px-2 py-0.5 text-xs font-medium text-muted">
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
  const keepValuesSubmit1 = useKeepFormValues(verifyState, verifyAction);
  const [lifeState, lifeAction, changing] = useActionState(setRegisterLifecycleAction, initialState);
  const keepValuesSubmit2 = useKeepFormValues(lifeState, lifeAction);
  const [recalState, recalAction, recalibrating] = useActionState(recalibrateInstrumentAction, initialState);
  const keepValuesSubmit_recalAction = useKeepFormValues(recalState, recalAction);
  const inactive = !!lifecycleStatus && lifecycleStatus !== "active";
  const unverified = verifiedAt === null;

  return (
    <div className="flex flex-wrap items-start gap-2">
      {unverified && (
        <form onSubmit={keepValuesSubmit1}>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="project_id" value={projectId} />
          <Button type="submit" disabled={verifying} variant="outline" size="sm">
            {verifying ? "Verifying…" : "Verify"}
          </Button>
        </form>
      )}

      {kind === "calibration" && !inactive && (
        <Disclosure variant="inline" summary={<><Tx>Recalibrate</Tx></>} className="relative">
          <form onSubmit={keepValuesSubmit_recalAction} className="mt-1 w-72 space-y-2 rounded-md border border-border bg-surface p-3 shadow-md">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="project_id" value={projectId} />
            <p className="text-xs text-muted"><Tx>Keeps the old certificate on record and adds the new one, so earlier inspections stay traceable.</Tx></p>
            <label className="block text-xs font-medium text-ink">
              <Tx>New certificate number</Tx>
              <input name="cert_number" required className={INPUT} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-medium text-ink">
                <Tx>Calibrated</Tx>
                <input name="cal_date" type="date" required className={INPUT} />
              </label>
              <label className="block text-xs font-medium text-ink">
                <Tx>Next due</Tx>
                <input name="due_date" type="date" required className={INPUT} />
              </label>
            </div>
            <label className="block text-xs font-medium text-ink">
              <Tx>As-found result (previous cycle)</Tx>
              <select name="as_found_result" defaultValue="not_recorded" className={INPUT}>
                <option value="not_recorded"><Tx>Not recorded</Tx></option>
                <option value="in_tolerance"><Tx>In tolerance</Tx></option>
                <option value="out_of_tolerance"><Tx>Out of tolerance</Tx></option>
              </select>
            </label>
            <label className="block text-xs font-medium text-ink">
              <Tx>As-found notes (required if out of tolerance)</Tx>
              <textarea name="as_found_notes" rows={2} className={INPUT} />
            </label>
            <CertificateUpload projectId={projectId} kind="calibration" label="New certificate (optional)" />
            {recalState.error && <p role="alert" className="text-xs text-danger">{recalState.error}</p>}
            <Button type="submit" disabled={recalibrating} size="sm">
              {recalibrating ? "Saving…" : "Record recalibration"}
            </Button>
          </form>
</Disclosure>
      )}

      <Disclosure variant="inline" summary={<>{inactive ? "Reactivate" : "Retire"}</>} className="relative">
        <form onSubmit={keepValuesSubmit2} className="mt-1 w-64 space-y-2 rounded-md border border-border bg-surface p-3 shadow-md">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="project_id" value={projectId} />
          {inactive ? (
            <input type="hidden" name="lifecycle_status" value="active" />
          ) : (
            <>
              <label className="block text-xs font-medium text-ink">
                <Tx>Mark as</Tx>
                <select name="lifecycle_status" defaultValue="retired" className={INPUT}>
                  <option value="retired"><Tx>Retired (no longer used)</Tx></option>
                  <option value="superseded"><Tx>Superseded (replaced)</Tx></option>
                  <option value="withdrawn"><Tx>Withdrawn (entered in error / rejected)</Tx></option>
                </select>
              </label>
              <label className="block text-xs font-medium text-ink">
                <Tx>Reason</Tx>
                <input name="reason" required className={INPUT} />
              </label>
            </>
          )}
          {lifeState.error && <p role="alert" className="text-xs text-danger">{lifeState.error}</p>}
          <button type="submit" disabled={changing} className="rounded-md border border-border px-3 py-1 text-xs font-medium text-ink disabled:opacity-50">
            {changing ? "Saving…" : inactive ? "Reactivate entry" : "Retire entry"}
          </button>
        </form>
</Disclosure>
      {verifyState.error && <span className="block max-w-xs text-xs text-danger">{verifyState.error}</span>}
    </div>
  );
}
