"use client";

import { useActionState } from "react";
import {
  addRootCauseCategoryAction,
  updateRootCauseCategoryAction,
  type TaxonomyState,
} from "@/lib/ncrs/taxonomy-actions";
import { Button } from "@/components/ui/button";

const initial: TaxonomyState = { error: null };
const INPUT = "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-burgundy";

function Message({ state }: { state: TaxonomyState }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      )}
      {!state.error && state.success && (
        <p role="status" className="text-xs text-muted">
          ✓ {state.success}
        </p>
      )}
    </>
  );
}

export function AddCategoryForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(addRootCauseCategoryAction, initial);
  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
      <input type="hidden" name="organization_id" value={organizationId} />
      <div>
        <label htmlFor="rc-label" className="block text-xs font-medium text-muted">New category</label>
        <input id="rc-label" name="label" required minLength={2} maxLength={80} placeholder="e.g. Permit-to-work gap" className={`mt-1 w-72 ${INPUT}`} />
      </div>
      <div>
        <label htmlFor="rc-sort" className="block text-xs font-medium text-muted">Order</label>
        <input id="rc-sort" name="sort_order" inputMode="numeric" defaultValue="200" className={`mt-1 w-20 ${INPUT}`} />
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add category"}</Button>
      <div className="w-full"><Message state={state} /></div>
    </form>
  );
}

export function EditCategoryRow({
  id,
  organizationId,
  label,
  sortOrder,
  isActive,
  used,
}: {
  id: string;
  organizationId: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  used: number;
}) {
  const [state, formAction, pending] = useActionState(updateRootCauseCategoryAction, initial);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3 px-4 py-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="organization_id" value={organizationId} />
      <input name="label" defaultValue={label} aria-label="Category name" required minLength={2} maxLength={80} className={`w-64 ${INPUT}`} />
      <input name="sort_order" defaultValue={sortOrder} aria-label="Order" inputMode="numeric" className={`w-20 ${INPUT}`} />
      <label className="flex items-center gap-1.5 text-xs text-ink">
        <input type="checkbox" name="is_active" defaultChecked={isActive} /> Active
      </label>
      <span className="text-xs text-muted">{used} NCR{used === 1 ? "" : "s"}</span>
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      <div className="w-full"><Message state={state} /></div>
    </form>
  );
}
