"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { requestCorrectionAction } from "@/lib/checklists/correction-request-actions";
import { notifyPartyAction, proceedWithoutResponseAction, rejectSignoffAction, signOffAction, withdrawSignoffAction } from "@/lib/signoff/actions";
import type { SignoffStatus } from "@/lib/signoff/db-types";
import { ON_BEHALF_REASON_PREFIX } from "@/lib/signoff/on-behalf";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { CellMenu, type CellMenuItem } from "@/components/domain/cell-menu";

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

function StatusIcon({ status }: { status: SignoffStatus }) {
  const common = { "aria-hidden": true, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round", className: "h-3.5 w-3.5 shrink-0" } as const;
  if (status === "signed_off") return <svg {...common}><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>;
  if (status === "notified") return <svg {...common}><path d="M10 3.5a4.5 4.5 0 00-4.5 4.5v2.5L4 13h12l-1.5-2.5V8A4.5 4.5 0 0010 3.5zM8.5 15.5a1.5 1.5 0 003 0" /></svg>;
  if (status === "proceeded_no_response") return <svg {...common}><path d="M4 10h11M11 6l4 4-4 4" /></svg>;
  return <svg {...common}><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5V10l2.5 1.5" /></svg>;
}

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
  rejectionReason = null,
  signoffComment = null,
  layout = "stacked",
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
  /** S4-18: why the party last rejected this release (shown until it is signed). */
  rejectionReason?: string | null;
  /** S4-18: comment the party recorded with the sign-off. */
  signoffComment?: string | null;
  /** "stacked" = the original centred column of status + buttons (dashboards). "compact" = left-aligned status
   *  with ONE primary action and the rest in an overflow menu (the ITP sign-off grid). Same actions either way. */
  layout?: "stacked" | "compact";
}) {
  const tl = useTranslate();
  const [isPending, startTransition] = useTransition();
  const { ask, dialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  // Which action is collecting a mandatory written reason (proceed / withdraw) before it runs.
  const [reasonFor, setReasonFor] = useState<"proceed" | "withdraw" | "reject" | "comment" | "correction" | null>(null);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-mount / external-event sync (hydration-safe default, then real value); not derivable during render
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

  const btn = "min-h-8 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-off-white disabled:opacity-50";
  const canWithdraw = isJagsStaff && (optimisticStatus === "signed_off" || optimisticStatus === "proceeded_no_response");
  // A party who recorded the sign-off cannot withdraw it (staff only): they ask for a correction instead.
  const canRequestCorrection = !isJagsStaff && canSignOffForThisParty && optimisticStatus === "signed_off";
  const canRenotify = optimisticStatus === "notified" && canSignOffForThisParty;

  function doNotify() {
    run(() => notifyPartyAction(progressId), "notified");
  }
  function doSignOff() {
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
    }, "signed_off");
  }
  function confirmReason() {
        if (reasonFor === "proceed") return run(() => proceedWithoutResponseAction(progressId, reason), "proceeded_no_response");
        if (reasonFor === "correction") {
          const fd = new FormData();
          fd.set("signoff_progress_id", progressId);
          fd.set("reason", reason);
          return run(() => requestCorrectionAction({ error: null }, fd), "signed_off");
        }
        if (reasonFor === "reject") return run(() => rejectSignoffAction(progressId, reason), "pending");
        if (reasonFor === "comment") {
          const text = reason;
          return run(async () => {
            const first = await signOffAction(progressId, undefined, text);
            if (first.error && first.error.startsWith(ON_BEHALF_REASON_PREFIX)) {
              const why = await ask({
                title: "Sign off on behalf of this party",
                message: "You are signing on behalf of this party. Your reason is recorded.",
                confirmLabel: "Sign off",
                reason: { label: "Reason (at least 10 characters)", minLength: 10 },
              });
              if (!why) return { error: null };
              return signOffAction(progressId, why, text);
            }
            return first;
          }, "signed_off");
        }
        return run(() => withdrawSignoffAction(progressId, reason), "pending");
  }
  const reasonPlaceholder =
    reasonFor === "proceed"
      ? "Reason for proceeding without response"
      : reasonFor === "reject"
        ? "Why is this rejected? (at least 10 characters)"
        : reasonFor === "comment"
          ? "Comment to record with the sign-off"
          : reasonFor === "correction"
            ? "What needs correcting and why (at least 10 characters)"
            : "Reason for withdrawing sign-off";
  const confirmDisabled = isPending || reason.trim().length < (reasonFor === "comment" ? 1 : reasonFor === "reject" || reasonFor === "correction" ? 10 : 5);

  // Compact layout: one primary action (the most likely next step) + the rest in the overflow menu.
  const tx = (text: string) => <Tx>{text}</Tx>;
  const all: (CellMenuItem & { show: boolean })[] = [
    { key: "notify", label: tx("Notify"), show: canNotify, onSelect: doNotify },
    { key: "signoff", label: tx("Sign off"), show: canSignOff, onSelect: doSignOff },
    { key: "proceed", label: tx("Proceed"), show: canProceed, onSelect: () => setReasonFor("proceed") },
    { key: "correction", label: tx("Request correction"), show: canRequestCorrection && reasonFor === null, onSelect: () => setReasonFor("correction") },
    { key: "withdraw", label: tx("Withdraw"), show: canWithdraw && reasonFor === null, onSelect: () => setReasonFor("withdraw") },
    { key: "renotify", label: tx("Re-notify"), show: canRenotify, title: "Record another reminder (does not restart the notice period)", onSelect: doNotify },
    { key: "comment", label: tx("Sign with comment"), show: canSignOff, title: "Sign off and record a comment with it", onSelect: () => setReasonFor("comment") },
    { key: "reject", label: tx("Reject"), show: canSignOff, title: "Return this release with a reason; the inspector is told what to fix", onSelect: () => setReasonFor("reject") },
  ];
  const visible = all.filter((a) => a.show);
  const actions = { primary: visible[0] ?? null, menu: visible.slice(1) };

  if (layout === "compact") {
    return (
      <div className="flex w-full min-w-0 flex-col items-start gap-1.5">
        {dialog}
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[optimisticStatus]}`}
          title={tl(STATUS_HELP[optimisticStatus])}
        >
          <StatusIcon status={optimisticStatus} />
          <Tx>{STATUS_LABEL[optimisticStatus]}</Tx>
        </span>
        {deadlineMs != null && now != null && (
          <span
            className={`text-xs ${noticeElapsed ? (isBlocking ? "text-danger" : "text-info") : "text-muted"}`}
            title={isBlocking ? "A Hold always waits for release regardless of elapsed time (R77)" : undefined}
          >
            {noticeElapsed && isBlocking ? "Elapsed, still waiting for release" : formatCountdown(deadlineMs, now)}
          </span>
        )}
        {noticeWarning && optimisticStatus === "pending" && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${noticeWarning.status === "overdue" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning"}`}
            title={noticeWarning.message ?? undefined}
          >
            {noticeWarning.status === "overdue" ? "Planned date passed" : "Short notice"}
          </span>
        )}
        {rejectionReason && optimisticStatus !== "signed_off" && (
          <span className="max-w-full rounded bg-danger/10 px-1.5 py-0.5 text-xs text-danger [overflow-wrap:anywhere]" title={rejectionReason}>
            <Tx>Rejected:</Tx> {rejectionReason.length > 60 ? `${rejectionReason.slice(0, 60)}…` : rejectionReason}
          </span>
        )}
        {signoffComment && optimisticStatus === "signed_off" && (
          <span className="max-w-full text-xs text-muted [overflow-wrap:anywhere]" title={signoffComment}>
            <Tx>Comment:</Tx> {signoffComment.length > 60 ? `${signoffComment.slice(0, 60)}…` : signoffComment}
          </span>
        )}
        {!canSignOff && (optimisticStatus === "pending" || optimisticStatus === "notified") && !canSignOffForThisParty && (
          <span className="text-xs text-muted" title={tl("Only this party's own login (or JAGS staff) can sign off")}>
            <Tx>Awaiting party</Tx>
          </span>
        )}
        {reasonFor === null && actions.primary && (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={actions.primary.key === "signoff" || actions.primary.key === "notify" ? "primary" : "outline"}
              disabled={isPending}
              title={actions.primary.title ? tl(actions.primary.title) : undefined}
              onClick={actions.primary.onSelect}
            >
              {actions.primary.label}
            </Button>
            <CellMenu items={actions.menu} ariaLabel={tl("More sign-off actions")} />
          </div>
        )}
        {reasonFor && (
          <div className="flex w-full min-w-0 flex-col gap-1.5">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={reasonPlaceholder}
              aria-label={reasonPlaceholder}
              className="w-full rounded-md border border-control-border bg-surface px-2 py-1.5 text-sm"
            />
            <div className="flex gap-1.5">
              <Button type="button" size="sm" disabled={confirmDisabled} onClick={confirmReason}>
                <Tx>Confirm</Tx>
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setReasonFor(null); setReason(""); }}>
                <Tx>Cancel</Tx>
              </Button>
            </div>
          </div>
        )}
        {error && <span role="alert" className="text-xs text-danger">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      {dialog}
      <span
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_TONE[optimisticStatus]}`}
        title={STATUS_HELP[optimisticStatus]}
      >
        {STATUS_LABEL[optimisticStatus]}
      </span>
      {deadlineMs != null && now != null && (
        <span
          className={`text-xs ${noticeElapsed ? (isBlocking ? "text-danger" : "text-info") : "text-muted"}`}
          title={isBlocking ? "A Hold always waits for release regardless of elapsed time (R77)" : undefined}
        >
          {noticeElapsed && isBlocking ? "Elapsed — still waiting for release" : formatCountdown(deadlineMs, now)}
        </span>
      )}
      {noticeWarning && optimisticStatus === "pending" && (
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${noticeWarning.status === "overdue" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning"}`}
          title={noticeWarning.message ?? undefined}
        >
          {noticeWarning.status === "overdue" ? "Planned date passed" : "Short notice"}
        </span>
      )}
      {noticeWarning?.message && optimisticStatus === "pending" && (
        <span className="max-w-40 text-xs text-muted">{noticeWarning.message}</span>
      )}
      <div className="flex gap-1">
        {canNotify && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => notifyPartyAction(progressId), "notified")}
            className={btn}
          >
            <Tx>Notify</Tx>
          </button>
        )}
        {canRenotify && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => notifyPartyAction(progressId), "notified")}
            className={btn}
            title={tl("Record another reminder (does not restart the notice period)")}
          >
            <Tx>Re-notify</Tx>
          </button>
        )}
        {canSignOff && (
          <button
            type="button"
            disabled={isPending}
            onClick={doSignOff}
            className={btn}
          >
            <Tx>Sign off</Tx>
          </button>
        )}
        {!canSignOff && (optimisticStatus === "pending" || optimisticStatus === "notified") && !canSignOffForThisParty && (
          <span className="text-xs text-muted" title={tl("Only this party's own login (or JAGS staff) can sign off")}>
            <Tx>Awaiting party</Tx>
          </span>
        )}
        {canSignOff && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setReasonFor("comment")}
            className={btn}
            title={tl("Sign off and record a comment with it")}
          >
            <Tx>Sign with comment</Tx>
          </button>
        )}
        {canSignOff && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setReasonFor("reject")}
            className={btn}
            title={tl("Return this release with a reason; the inspector is told what to fix")}
          >
            <Tx>Reject</Tx>
          </button>
        )}
        {canProceed && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setReasonFor("proceed")}
            className={btn}
          >
            <Tx>Proceed</Tx>
          </button>
        )}
        {canRequestCorrection && reasonFor === null && (
          <button type="button" disabled={isPending} onClick={() => setReasonFor("correction")} className={btn}>
            <Tx>Request correction</Tx>
          </button>
        )}
        {canWithdraw && reasonFor === null && (
          <button type="button" disabled={isPending} onClick={() => setReasonFor("withdraw")} className={btn}>
            <Tx>Withdraw</Tx>
          </button>
        )}
      </div>
      {rejectionReason && optimisticStatus !== "signed_off" && (
        <span className="max-w-44 rounded bg-danger/10 px-1.5 py-0.5 text-xs text-danger" title={rejectionReason}>
          <Tx>Rejected:</Tx> {rejectionReason.length > 80 ? `${rejectionReason.slice(0, 80)}…` : rejectionReason}
        </span>
      )}
      {signoffComment && optimisticStatus === "signed_off" && (
        <span className="max-w-44 text-xs text-muted" title={signoffComment}>
          <Tx>Comment:</Tx> {signoffComment.length > 80 ? `${signoffComment.slice(0, 80)}…` : signoffComment}
        </span>
      )}
      {reasonFor && (
        <div className="flex w-full min-w-40 flex-col gap-1">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder={
              reasonFor === "proceed"
                ? "Reason for proceeding without response"
                : reasonFor === "reject"
                  ? "Why is this rejected? (at least 10 characters)"
                  : reasonFor === "comment"
                    ? "Comment to record with the sign-off"
                    : reasonFor === "correction"
                      ? "What needs correcting and why (at least 10 characters)"
                      : "Reason for withdrawing sign-off"
            }
            className="w-full rounded border border-border bg-surface px-1.5 py-1 text-xs"
          />
          <div className="flex justify-center gap-1">
            <button
              type="button"
              disabled={isPending || reason.trim().length < (reasonFor === "comment" ? 1 : reasonFor === "reject" || reasonFor === "correction" ? 10 : 5)}
              onClick={confirmReason}
              className={btn}
            >
              <Tx>Confirm</Tx>
            </button>
            <button type="button" onClick={() => { setReasonFor(null); setReason(""); }} className={btn}>
              <Tx>Cancel</Tx>
            </button>
          </div>
        </div>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
