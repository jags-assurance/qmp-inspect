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
  const [state, action, pending] = useActionState(editNcrDetailsAction, { error: null } as EditNcrDetailsState);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (state.done) doneRef.current?.();
  }, [state]);
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium text-burgundy">Correct the description</summary>
      <form action={action} className="mt-2 space-y-3">
        <input type="hidden" name="ncr_id" value={ncrId} />
        <textarea name="description" rows={3} required minLength={10} defaultValue={description} className={field} aria-label="Description" />
        <textarea name="requirement_not_met" rows={2} defaultValue={requirementNotMet ?? ""} placeholder="Requirement not met (optional)" className={field} aria-label="Requirement not met" />
        {showExtended && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input name="location" defaultValue={location ?? ""} maxLength={200} placeholder="Location / area" className={field} aria-label="Location" />
            <input name="equipment_tag" defaultValue={equipmentTag ?? ""} maxLength={200} placeholder="Equipment tag" className={field} aria-label="Equipment tag" />
            <input name="spec_reference" defaultValue={specReference ?? ""} maxLength={200} placeholder="Spec clause" className={field} aria-label="Spec clause" />
          </div>
        )}
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save corrections"}
        </Button>
      </form>
    </details>
  );
}

/** Withdraw an NCR raised in error / as a duplicate: closed with a reason, excluded from gates. */
export function WithdrawNcrForm({ ncrId, others, onDone }: { ncrId: string; others: { id: string; ncr_number: string }[]; onDone?: () => void }) {
  const [state, action, pending] = useActionState(withdrawNcrAction, { error: null } as WithdrawNcrState);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (state.done) doneRef.current?.();
  }, [state]);
  return (
    <details className="mt-4 border-t border-border pt-4 text-sm">
      <summary className="cursor-pointer font-medium text-ink">Withdraw (raised in error / duplicate)</summary>
      <form action={action} className="mt-2 space-y-2">
        <input type="hidden" name="ncr_id" value={ncrId} />
        <textarea name="reason" rows={2} required minLength={WITHDRAW_REASON_MIN} placeholder="Why is this being withdrawn? (required)" className={field} aria-label="Reason" />
        {others.length > 0 && (
          <select name="duplicate_of_ncr_id" defaultValue="" className={field} aria-label="Duplicate of">
            <option value="">Not a duplicate</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                Duplicate of {o.ncr_number}
              </option>
            ))}
          </select>
        )}
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        <Button type="submit" variant="outline" disabled={pending} onClick={(e) => { if (!window.confirm("Withdraw this NCR? It will be closed and its punch item withdrawn with it.")) e.preventDefault(); }}>
          {pending ? "Withdrawing…" : "Withdraw NCR"}
        </Button>
      </form>
    </details>
  );
}

/** Repair path when the punch item was never created (or was lost). Idempotent. */
export function EnsurePunchButton({ ncrId, onDone }: { ncrId: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState(ensureNcrPunchItemAction, { error: null } as EnsurePunchState);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (state.done) doneRef.current?.();
  }, [state]);
  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="ncr_id" value={ncrId} />
      <p className="text-sm text-warning">This NCR has no punch-list item, so handover tracking would miss it.</p>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Creating…" : "Create missing punch item"}
      </Button>
      {state.error && <p className="mt-1 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
