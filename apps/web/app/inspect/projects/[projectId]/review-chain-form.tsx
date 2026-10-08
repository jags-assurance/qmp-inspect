"use client";

import { useActionState, useState } from "react";
import { setProjectReviewChainAction, type SetReviewChainState } from "@/lib/itps/review-chain-actions";

const initialState: SetReviewChainState = { error: null };

/**
 * Admin-only ordered reviewer picker for this project's ITPs — up to 5 slots, each a staff member,
 * in the order they must review. Blank slots at the end are just omitted; you don't have to fill
 * all 5. Saving replaces the whole chain (see setProjectReviewChainAction's own doc comment).
 */
export function ReviewChainForm({
  projectId,
  staff,
  initialChain,
}: {
  projectId: string;
  staff: { id: string; full_name: string }[];
  initialChain: { reviewerUserId: string }[];
}) {
  const [state, formAction, pending] = useActionState(setProjectReviewChainAction, initialState);
  const slotCount = Math.max(initialChain.length + 1, 3);
  const [slots] = useState(Array.from({ length: Math.min(slotCount, 5) }));

  return (
    <form action={formAction} className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">ITP review chain (optional)</h2>
      <p className="mt-1 text-xs text-muted">
        Leave blank to keep today&apos;s behaviour (any JAGS staff can Approve). Set an ordered list and
        each reviewer must approve, in order, before the ITP auto-approves.
      </p>
      <input type="hidden" name="project_id" value={projectId} />
      <div className="mt-3 space-y-2">
        {slots.map((_, i) => (
          <select
            key={i}
            name="reviewer_user_ids"
            defaultValue={initialChain[i]?.reviewerUserId ?? ""}
            className="w-full rounded-md border border-border bg-off-white px-2.5 py-1.5 text-sm"
          >
            <option value="">— Step {i + 1}: none —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        ))}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded-md border border-border bg-off-white px-3 py-1.5 text-sm font-medium hover:bg-border/30 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save review chain"}
      </button>
      {state.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
