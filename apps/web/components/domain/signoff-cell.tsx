"use client";

import { useEffect, useState, useTransition } from "react";
import { notifyPartyAction, proceedWithoutResponseAction, signOffAction } from "@/lib/signoff/actions";
import type { SignoffStatus } from "@/lib/signoff/db-types";

/** "2h 14m left" / "14m left" / "Notice period elapsed" — R77-78's visible countdown, computed from
 *  the same notified_at + noticeHours the server already enforces (proceedWithoutResponseAction),
 *  so this can never show a countdown the backend doesn't actually agree with. */
function formatCountdown(deadlineMs: number, nowMs: number): string {
  const remainingMs = deadlineMs - nowMs;
  if (remainingMs <= 0) return "Notice period elapsed";
  const totalMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

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
  isBlocking,
  status,
  notifiedAt,
  noticeHours,
  canSignOff: canSignOffForThisParty,
  isJagsStaff,
}: {
  progressId: string;
  /** Whether this activity's ORGANISATION has configured this level as blocking (Hold-equivalent).
   *  Only a non-blocking level can ever "proceed without response" — a blocking level must always
   *  get an actual sign-off, mirroring the DB-level canCompleteInspection check. */
  isBlocking: boolean;
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

  const deadlineMs =
    status === "notified" && notifiedAt && noticeHours != null
      ? new Date(notifiedAt).getTime() + noticeHours * 60 * 60 * 1000
      : null;

  // Ticking countdown: starts at Date.now() (client-only, so this never mismatches the server
  // render) and re-renders every 30s — a per-activity notice period is measured in hours, so a
  // faster tick would just churn the DOM for no visible benefit.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (deadlineMs == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [deadlineMs]);

  const noticeElapsed = deadlineMs != null && now != null ? now >= deadlineMs : false;

  const canNotify = status === "pending";
  const canSignOff = (status === "pending" || status === "notified") && canSignOffForThisParty;
  const canProceed = !isBlocking && status === "notified" && noticeElapsed && isJagsStaff;

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
      {deadlineMs != null && now != null && (
        <span
          className={`text-[10px] ${noticeElapsed ? (isBlocking ? "text-danger" : "text-info") : "text-muted"}`}
          title={isBlocking ? "A Hold always waits for release regardless of elapsed time (R77)" : undefined}
        >
          {noticeElapsed && isBlocking ? "Elapsed — still waiting for release" : formatCountdown(deadlineMs, now)}
        </span>
      )}
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
