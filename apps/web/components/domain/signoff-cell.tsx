"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { notifyPartyAction, proceedWithoutResponseAction, signOffAction, withdrawSignoffAction } from "@/lib/signoff/actions";
import type { SignoffStatus } from "@/lib/signoff/db-types";
import { ON_BEHALF_REASON_PREFIX } from "@/lib/signoff/on-behalf";
import { useConfirm } from "@/components/ui/confirm-dialog";

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

const STATUS_HELP: Record<SignoffStatus, string> = {
  pending: "Not yet notified. The party has not been told this inspection is due.",
  notified: "Party notified. The notice period is running.",
  signed_off: "Released / signed off by the party.",
  proceeded_no_response: "Notice period elapsed with no response; work proceeded with a recorded reason.",
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
  noticeWarning = null,
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
  /** Short-notice / overdue planned-date warning (pending cells only); advisory, never blocks. */
  noticeWarning?: { status: "short_notice" | "overdue"; message: string | null } | null;
}) {
  const [isPending, startTransition] = useTransition();
  const { ask, dialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  // Which action is collecting a mandatory written reason (proceed / withdraw) before it runs.
  const [reasonFor, setReasonFor] = useState<"proceed" | "withdraw" | null>(null);
  const [reason, setReason] = useState("");

  // Real bug found live: clicking Notify/Sign off/Proceed didn't visibly change anything until the
  // full page re-fetched after revalidatePath — on this page (a lot of data) that round trip is
  // slow enough that the click looked like it did nothing. Flips the badge/buttons the instant
  // you click instead; React reverts this back to the real `status` prop on its own once the
  // transition settles — immediately, if the mutation succeeded and the prop now matches, or back
  // to the pre-click state if it failed (see the error message shown below either way).
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(status);

  const deadlineMs =
    optimisticStatus === "notified" && notifiedAt && noticeHours != null
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

  // R66-R81: Notify is that party's own step to trigger (or JAGS staff's) — not any other party's
  // on the project. Previously ungated (shown to every viewer on every pending cell); now uses the
  // same canSignOffForThisParty check Sign off already used, mirrored server-side in
  // notifyPartyAction.
  const canNotify = optimisticStatus === "pending" && canSignOffForThisParty;
  const canSignOff = (optimisticStatus === "pending" || optimisticStatus === "notified") && canSignOffForThisParty;
  const canProceed = !isBlocking && optimisticStatus === "notified" && noticeElapsed && isJagsStaff;

  function run(action: () => Promise<{ error: string | null }>, nextStatus: SignoffStatus) {
    setError(null);
    startTransition(async () => {
      setOptimisticStatus(nextStatus);
      const result = await action();
      if (result.error) setError(result.error);
      else {
        setReasonFor(null);
        setReason("");
      }
    });
  }

  const btn = "min-h-8 rounded border border-border px-2 py-1 text-[11px] font-medium hover:bg-off-white disabled:opacity-50";
  const canWithdraw = isJagsStaff && (optimisticStatus === "signed_off" || optimisticStatus === "proceeded_no_response");
  const canRenotify = optimisticStatus === "notified" && canSignOffForThisParty;

  return (
    <div className="flex flex-col items-center gap-1">
      {dialog}
      <span
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[optimisticStatus]}`}
        title={STATUS_HELP[optimisticStatus]}
      >
        {STATUS_LABEL[optimisticStatus]}
      </span>
      {deadlineMs != null && now != null && (
        <span
          className={`text-[10px] ${noticeElapsed ? (isBlocking ? "text-danger" : "text-info") : "text-muted"}`}
          title={isBlocking ? "A Hold always waits for release regardless of elapsed time (R77)" : undefined}
        >
          {noticeElapsed && isBlocking ? "Elapsed — still waiting for release" : formatCountdown(deadlineMs, now)}
        </span>
      )}
      {noticeWarning && optimisticStatus === "pending" && (
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${noticeWarning.status === "overdue" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning"}`}
          title={noticeWarning.message ?? undefined}
        >
          {noticeWarning.status === "overdue" ? "Planned date passed" : "Short notice"}
        </span>
      )}
      {noticeWarning?.message && optimisticStatus === "pending" && (
        <span className="max-w-40 text-[10px] text-muted">{noticeWarning.message}</span>
      )}
      <div className="flex gap-1">
        {canNotify && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => notifyPartyAction(progressId), "notified")}
            className={btn}
          >
            Notify
          </button>
        )}
        {canRenotify && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => notifyPartyAction(progressId), "notified")}
            className={btn}
            title="Record another reminder (does not restart the notice period)"
          >
            Re-notify
          </button>
        )}
        {canSignOff && (
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              run(async () => {
                const first = await signOffAction(progressId);
                if (first.error && first.error.startsWith(ON_BEHALF_REASON_PREFIX)) {
                  const why = await ask({
                    title: "Sign off on behalf of this party",
                    message: "You are signing on behalf of this party. Your reason is recorded.",
                    confirmLabel: "Sign off",
                    reason: { label: "Reason (at least 10 characters)", minLength: 10 },
                  });
                  if (!why) return { error: null };
                  return signOffAction(progressId, why);
                }
                return first;
              }, "signed_off")
            }
            className={btn}
          >
            Sign off
          </button>
        )}
        {!canSignOff && (optimisticStatus === "pending" || optimisticStatus === "notified") && !canSignOffForThisParty && (
          <span className="text-[10px] text-muted" title="Only this party's own login (or JAGS staff) can sign off">
            Awaiting party
          </span>
        )}
        {canProceed && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setReasonFor("proceed")}
            className={btn}
          >
            Proceed
          </button>
        )}
        {canWithdraw && reasonFor === null && (
          <button type="button" disabled={isPending} onClick={() => setReasonFor("withdraw")} className={btn}>
            Withdraw
          </button>
        )}
      </div>
      {reasonFor && (
        <div className="flex w-full min-w-40 flex-col gap-1">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={reasonFor === "proceed" ? "Reason for proceeding without response" : "Reason for withdrawing sign-off"}
            className="w-full rounded border border-border bg-surface px-1.5 py-1 text-[11px]"
          />
          <div className="flex justify-center gap-1">
            <button
              type="button"
              disabled={isPending || reason.trim().length < 5}
              onClick={() =>
                reasonFor === "proceed"
                  ? run(() => proceedWithoutResponseAction(progressId, reason), "proceeded_no_response")
                  : run(() => withdrawSignoffAction(progressId, reason), "pending")
              }
              className={btn}
            >
              Confirm
            </button>
            <button type="button" onClick={() => { setReasonFor(null); setReason(""); }} className={btn}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </div>
  );
}
