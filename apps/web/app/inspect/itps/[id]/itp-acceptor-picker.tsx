"use client";

import { useActionState } from "react";
import { assignItpAcceptorAction, type AssignItpAcceptorState } from "@/lib/itps/actions";

const initialState: AssignItpAcceptorState = { error: null };

/**
 * Admin-only single-select: assigns the ONE specific client-side login who may Accept this ITP
 * (itps.assigned_acceptor_user_id) — see assignItpAcceptorAction's doc comment. Leaving it on
 * "— Any linked client party —" keeps today's behaviour (any client-type login on the project can
 * accept). Candidates are this project's own active client-party logins only.
 */
export function ItpAcceptorPicker({
  itpId,
  clientPartyUsers,
  currentAcceptorUserId,
}: {
  itpId: string;
  clientPartyUsers: { userId: string; name: string }[];
  currentAcceptorUserId: string | null;
}) {
  const [state, formAction, pending] = useActionState(assignItpAcceptorAction, initialState);

  return (
    <form action={formAction} className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">Assigned acceptor (optional)</h3>
      <p className="mt-1 text-xs text-muted">
        Leave unset and any login linked to this project&apos;s client party can Accept. Assign one specific
        person and only they can.
      </p>
      <input type="hidden" name="itp_id" value={itpId} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          name="acceptor_user_id"
          defaultValue={currentAcceptorUserId ?? ""}
          className="min-w-56 rounded-md border border-border bg-off-white px-2.5 py-1.5 text-sm"
        >
          <option value="">— Any linked client party —</option>
          {clientPartyUsers.map((u) => (
            <option key={u.userId} value={u.userId}>
              {u.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border bg-off-white px-3 py-1.5 text-sm font-medium hover:bg-border/30 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {clientPartyUsers.length === 0 && (
        <p className="mt-2 text-xs text-warning">
          No active client-party login is linked to this project yet — provision one before assigning an acceptor.
        </p>
      )}
      {state.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
