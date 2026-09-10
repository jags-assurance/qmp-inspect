"use client";

import { useState, useTransition } from "react";
import { notifyPartyAction, proceedWithoutResponseAction, signOffAction } from "@/lib/signoff/actions";
import type { SignoffStatus } from "@/lib/signoff/db-types";
import type { InterventionLevel } from "@jags/shared-types";

const STATUS_LABEL: Record<SignoffStatus, string> = {
  pending: "Pending",
  notified: "Notified",
  signed_off: "Signed off",
  proceeded_no_response: "Proceeded (no response)",
};

const STATUS_TONE: Record<SignoffStatus, string> = {
  pending: "bg-muted/15 text-muted",
  notified: "bg-warning/10 text-warning",
  signed_off: "bg-success/10 text-success",
  proceeded_no_response: "bg-info/10 text-info",
};

/**
 * Sign-off status badge + contextual actions (Notify / Sign off / Proceed) for one party's H/W/R/S
 * level on an activity (R66-R81). Rendered by the ITP detail page next to that cell's
 * InterventionSelect, keyed off the same (itp_item, project_party) pair.
 */
export function SignoffCell({
  progressId,
  intervention,
  status,
  notifiedAt,
  noticeHours,
  canSignOff: canSignOffForThisParty,
  isJagsStaff,
}: {
  progressId: string;
  intervention: InterventionLevel;
  status: SignoffStatus;
  notifiedAt: string | null;
  noticeHours: number | null;
  /** Whether the CURRENT user may sign off for this specific party (staff, or that party's own linked login) — R66-R81 role restriction. */
  canSignOff: boolean;
  /** "Proceed without response" is the originator's (JAGS's) discretion call, not any party's —
   *  previously ungated, so the very party that failed to respond (or an unrelated third party)
   *  could click it once the notice period elapsed. */
  isJagsStaff: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const noticeElapsed =
    status === "notified" && notifiedAt && noticeHours != null
      ? Date.now() >= new Date(notifiedAt).getTime() + noticeHours * 60 * 60 * 1000
      : false;

  const canNotify = status === "pending";
  const canSignOff = (status === "pending" || status === "notified") && canSignOffForThisParty;
  const canProceed = intervention === "W" && status === "notified" && noticeElapsed && isJagsStaff;

  function run(action: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[status]}`}>
        {STATUS_LABEL[status]}
      </span>
      <div className="flex gap-1">
        {canNotify && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => notifyPartyAction(progressId))}
            className="rounded border border-border px-1 py-0.5 text-[10px] font-medium hover:bg-off-white disabled:opacity-50"
          >
            Notify
          </button>
        )}
        {canSignOff && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => signOffAction(progressId))}
            className="rounded border border-border px-1 py-0.5 text-[10px] font-medium hover:bg-off-white disabled:opacity-50"
          >
            Sign off
          </button>
        )}
        {!canSignOff && (status === "pending" || status === "notified") && !canSignOffForThisParty && (
          <span className="text-[10px] text-muted" title="Only this party's own login (or JAGS staff) can sign off">
            Awaiting party
          </span>
        )}
        {canProceed && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => proceedWithoutResponseAction(progressId))}
            className="rounded border border-border px-1 py-0.5 text-[10px] font-medium hover:bg-off-white disabled:opacity-50"
          >
            Proceed
          </button>
        )}
      </div>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </div>
  );
}
