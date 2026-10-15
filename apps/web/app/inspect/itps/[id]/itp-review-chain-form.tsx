"use client";

import { useActionState, useState } from "react";
import { setItpReviewChainAction, type SetReviewChainState } from "@/lib/itps/review-chain-actions";
import { Tx } from "@/components/domain/tx";
import { FormMessage } from "@/components/ui/form-message";
import { Button } from "@/components/ui/button";

const initialState: SetReviewChainState = { error: null };

/**
 * Per-ITP twin of the project's ReviewChainForm (app/inspect/projects/[projectId]/
 * review-chain-form.tsx) — same ordered-slots picker, but scoped to just this one ITP via
 * setItpReviewChainAction, overriding the project's own chain for this ITP specifically. Only
 * rendered (by the page) while the ITP is still 'draft' — see that action's own doc comment for why.
 */
export function ItpReviewChainForm({
  itpId,
  staff,
  initialChain,
  usingProjectDefault,
}: {
  itpId: string;
  staff: { id: string; full_name: string }[];
  initialChain: { reviewerUserId: string }[];
  /** Whether this ITP currently has no override of its own and is relying on the project's chain
   *  (or plain single-click Approve, if the project has no chain either) — shown so an Admin isn't
   *  guessing whether "blank" here means "no chain at all" or "using the project's." */
  usingProjectDefault: boolean;
}) {
  const [state, formAction, pending] = useActionState(setItpReviewChainAction, initialState);
  // Controlled on purpose: React resets uncontrolled fields after a form action, which made a just-saved
  // chain look blank (as if nothing had saved) until the page was reloaded.
  const slotCount = Math.min(Math.max(initialChain.length + 1, 3), 5);
  const [values, setValues] = useState<string[]>(() => Array.from({ length: slotCount }, (_, i) => initialChain[i]?.reviewerUserId ?? ""));

  return (
    <form action={formAction} className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink"><Tx>This ITP&apos;s own review chain (optional)</Tx></h3>
      <p className="mt-1 text-xs text-muted">
        {usingProjectDefault
          ? "Currently following the project's own review chain (or plain single-click Approve, if the project has none). Set an ordered list below to override it for just this ITP."
          : "This ITP has its own review chain, overriding the project's default."}
      </p>
      <input type="hidden" name="itp_id" value={itpId} />
      <div className="mt-3 space-y-2">
        {values.map((value, i) => (
          <select
            key={i}
            name="reviewer_user_ids"
            value={value}
            onChange={(e) => setValues((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
            className="w-full rounded-md border border-border bg-off-white px-2.5 py-1.5 text-sm"
          >
            <option value=""><Tx>— Step</Tx> {i + 1}<Tx>: none —</Tx></option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        ))}
        {values.length < 5 && (
          <Button type="button" onClick={() => setValues((prev) => [...prev, ""])} variant="link" size="sm">
            <Tx>+ Add another review step</Tx>
          </Button>
        )}
      </div>
      <Button
        type="submit"
        disabled={pending}
        variant="outline" size="sm" className="mt-3"
      >
        {pending ? "Saving…" : "Save this ITP's review chain"}
      </Button>
      <FormMessage error={state.error} success={state.saved && !pending ? "Review chain saved." : null} className="mt-2" />
    </form>
  );
}
