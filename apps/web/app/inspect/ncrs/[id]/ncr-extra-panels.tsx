"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  editNcrDetailsAction,
  ensureNcrPunchItemAction,
  withdrawNcrAction,
  type EditNcrDetailsState,
  type EnsurePunchState,
  type WithdrawNcrState,
} from "@/lib/ncrs/actions";
import { WITHDRAW_REASON_MIN } from "@/lib/ncrs/rules";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Disclosure } from "@/components/ui/disclosure";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const field = "mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy";

/** Raiser / staff: correct what the NCR describes (and where / which asset / which clause). */
export function EditNcrDetailsForm({
  ncrId,
  description,
  requirementNotMet,
  location,
  equipmentTag,
  specReference,
  showExtended,
  onDone,
}: {
  ncrId: string;
  description: string;
  requirementNotMet: string | null;
  location: string | null;
  equipmentTag: string | null;
  specReference: string | null;
  /** Only when the extended-fields migration is applied. */
  showExtended: boolean;
  onDone?: () => void;
}) {
  const tl = useTranslate();
  const [state, action, pending] = useActionState(editNcrDetailsAction, { error: null } as EditNcrDetailsState);
  const keepValuesSubmit1 = useKeepFormValues(state, action);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (state.done) doneRef.current?.();
  }, [state]);
  return (
    <Disclosure variant="inline" summary={<><Tx>Correct the description</Tx></>} className="mt-3 text-sm">
      <form onSubmit={keepValuesSubmit1} className="mt-2 space-y-3">
        <input type="hidden" name="ncr_id" value={ncrId} />
        <textarea name="description" rows={3} required minLength={10} defaultValue={description} className={field} aria-label={tl("Description")} />
        <textarea name="requirement_not_met" rows={2} defaultValue={requirementNotMet ?? ""} placeholder={tl("Requirement not met (optional)")} className={field} aria-label={tl("Requirement not met")} />
        {showExtended && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input name="location" defaultValue={location ?? ""} maxLength={200} placeholder={tl("Location / area")} className={field} aria-label={tl("Location")} />
            <input name="equipment_tag" defaultValue={equipmentTag ?? ""} maxLength={200} placeholder={tl("Equipment tag")} className={field} aria-label={tl("Equipment tag")} />
            <input name="spec_reference" defaultValue={specReference ?? ""} maxLength={200} placeholder={tl("Spec clause")} className={field} aria-label={tl("Spec clause")} />
          </div>
        )}
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save corrections"}
        </Button>
      </form>
</Disclosure>
  );
}

/** Withdraw an NCR raised in error / as a duplicate: closed with a reason, excluded from gates. */
export function WithdrawNcrForm({ ncrId, others, onDone }: { ncrId: string; others: { id: string; ncr_number: string }[]; onDone?: () => void }) {
  const tl = useTranslate();
  const [state, action, pending] = useActionState(withdrawNcrAction, { error: null } as WithdrawNcrState);
  const keepValuesSubmit2 = useKeepFormValues(state, action);
  const { askThenSubmit, dialog } = useConfirm();
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (state.done) doneRef.current?.();
  }, [state]);
  return (
    <Disclosure variant="inline" summary={<><Tx>Withdraw (raised in error / duplicate)</Tx></>} className="mt-4 border-t border-border pt-4 text-sm">
      <form onSubmit={keepValuesSubmit2} className="mt-2 space-y-2">
        {dialog}
        <input type="hidden" name="ncr_id" value={ncrId} />
        <textarea name="reason" rows={2} required minLength={WITHDRAW_REASON_MIN} placeholder={tl("Why is this being withdrawn? (required)")} className={field} aria-label={tl("Reason")} />
        {others.length > 0 && (
          <select name="duplicate_of_ncr_id" defaultValue="" className={field} aria-label={tl("Duplicate of")}>
            <option value=""><Tx>Not a duplicate</Tx></option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                <Tx>Duplicate of</Tx> {o.ncr_number}
              </option>
            ))}
          </select>
        )}
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        <Button type="submit" variant="outline" disabled={pending} onClick={askThenSubmit({ title: "Withdraw this NCR?", message: "It will be closed and its punch item withdrawn with it.", confirmLabel: "Withdraw NCR", destructive: true })}>
          {pending ? "Withdrawing…" : "Withdraw NCR"}
        </Button>
      </form>
</Disclosure>
  );
}

/** Repair path when the punch item was never created (or was lost). Idempotent. */
export function EnsurePunchButton({ ncrId, onDone }: { ncrId: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState(ensureNcrPunchItemAction, { error: null } as EnsurePunchState);
  const keepValuesSubmit3 = useKeepFormValues(state, action);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (state.done) doneRef.current?.();
  }, [state]);
  return (
    <form onSubmit={keepValuesSubmit3} className="mt-2">
      <input type="hidden" name="ncr_id" value={ncrId} />
      <p className="text-sm text-warning"><Tx>This NCR has no punch-list item, so handover tracking would miss it.</Tx></p>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Creating…" : "Create missing punch item"}
      </Button>
      {state.error && <p role="alert" className="mt-1 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
