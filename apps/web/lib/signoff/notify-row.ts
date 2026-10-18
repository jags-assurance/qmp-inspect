// Deliberately NOT "use server": the shared notify logic below takes a live Supabase client, which is
// not serialisable, and must not become a callable Server Action endpoint. It is moved here unchanged
// from ./actions.ts so the manual Notify buttons AND the phase-2 automation (./automation.ts) run the
// exact same code: same notification, same audit event, and the same rule that a re-notify never
// resets notified_at.

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { createNotification } from "@/lib/notifications/helpers";
import { recordAuditEvent } from "@/lib/audit/log";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE, type ActivitySignoffProgressRow } from "./db-types";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface SignoffActionResult {
  error: string | null;
}

export type NotifiableRow = Pick<
  ActivitySignoffProgressRow,
  "id" | "itp_item_id" | "project_party_id" | "intervention" | "status"
>;

/** Looks up the ITP id for a sign-off progress row's activity, to revalidate its detail page. */
export async function findItpIdForProgress(supabase: Client, itpItemId: string): Promise<string | null> {
  const { data } = await supabase
    .from("itp_items")
    .select("itp_sections(itp_id)")
    .eq("id", itpItemId)
    .maybeSingle<{ itp_sections: { itp_id: string } | null }>();
  return data?.itp_sections?.itp_id ?? null;
}

/**
 * Shared notify logic used by both the single-row Notify button (notifyPartyAction) and the
 * "Notify all pending" bulk action (notifyAllPendingForItpAction) — marks the row notified and
 * delivers a real in-app notification to that party's linked user (project_parties.user_id),
 * replacing what used to be a pure timestamp with no actual delivery. Best-effort: a party with no
 * linked login yet (set up in advance of that user's account existing, a legitimate real-world
 * ordering) simply gets no notification row — the notified_at timestamp is still the source of truth
 * for the notice-period clock either way, so delivery failures never block the status update. Does
 * NOT revalidate the page itself — callers do that once, after all rows they touch are done.
 */
export async function notifySignoffRow(supabase: Client, progress: NotifiableRow): Promise<SignoffActionResult> {
  // Only a pending row flips to notified (and gets notified_at, which starts the notice clock). A
  // re-notify of an already-notified row must NOT reset notified_at (that would restart the notice
  // period indefinitely) — it is recorded in the audit trail only.
  let renotifyOnly = false;
  let error: { message: string } | null = null;
  if (progress.status === "pending") {
    const res = await supabase
      .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
      .update({ status: "notified", notified_at: new Date().toISOString() })
      .eq("id", progress.id)
      .eq("status", "pending")
      .select("id");
    error = res.error;
    if (!error && (!res.data || res.data.length === 0)) {
      return { error: "This sign-off changed in the meantime. Refresh and check its status." };
    }
  } else if (progress.status === "notified") {
    renotifyOnly = true;
  } else {
    return { error: "This sign-off has already been cleared, so it can't be notified again." };
  }

  if (error) {
    // Real gap found live: this DB error was silently discarded — every caller only ever saw the
    // same generic permission message, with no way (not even in Vercel's own function logs) to tell
    // an RLS denial apart from an FK violation or anything else Postgres actually rejected it for.
    console.error(`[signoff] notifySignoffRow failed for progress ${progress.id}:`, error);
    return { error: "Could not notify the party. Check you have permission and try again." };
  }

  // Best-effort real notification delivery — failures here (missing user link, RLS denial for an
  // edge case) never surface as an error on the Notify action itself; the status update above is
  // what actually matters and has already succeeded.
  try {
    const itpId = await findItpIdForProgress(supabase, progress.itp_item_id);

    const { data: context } = await supabase
      .from("itp_items")
      .select("activity, itp_sections(itps(itp_number, project_id, projects(organization_id)))")
      .eq("id", progress.itp_item_id)
      .maybeSingle<{
        activity: string;
        itp_sections: {
          itps: {
            itp_number: string;
            project_id: string;
            projects: { organization_id: string } | null;
          } | null;
        } | null;
      }>();

    const { data: party } = await supabase
      .from("project_parties")
      .select("user_id, name")
      .eq("id", progress.project_party_id)
      .maybeSingle<{ user_id: string | null; name: string }>();

    const itp = context?.itp_sections?.itps;
    const organizationId = itp?.projects?.organization_id;

    let levelLabel: string | null = null;
    if (organizationId) {
      const { data: levelType } = await supabase
        .from(INTERVENTION_LEVEL_TYPES_TABLE)
        .select("label")
        .eq("organization_id", organizationId)
        .eq("code", progress.intervention)
        .maybeSingle<{ label: string }>();
      levelLabel = levelType?.label ?? null;
    }

    if (!renotifyOnly && party?.user_id && itp && organizationId) {
      await createNotification(supabase, {
        organizationId,
        projectId: itp.project_id,
        recipientUserId: party.user_id,
        title: `${levelLabel ?? progress.intervention} sign-off needed`,
        body: `${itp.itp_number} — ${context?.activity ?? "an activity"}`,
        link: itpId ? `/inspect/itps/${itpId}` : `/inspect/projects/${itp.project_id}`,
      });
    }

    // Best-effort: the audit trail is a convenience layer on top of the real, already-succeeded
    // status update above — see lib/audit/log.ts's doc comment. Recorded regardless of whether the
    // party has a linked user (unlike the notification above), since the notify event itself
    // happened either way.
    if (itp && organizationId) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      await recordAuditEvent(supabase, {
        organizationId,
        projectId: itp.project_id,
        entityType: "signoff",
        entityId: progress.id,
        action: renotifyOnly ? "renotified" : "notified",
        actorId: user?.id ?? null,
        summary: `${party?.name ?? "Party"} ${renotifyOnly ? "re-notified (reminder logged, notice period unchanged)" : "notified"} of ${levelLabel ?? progress.intervention} sign-off on ${itp.itp_number}`,
      });
    }
  } catch {
    // Notification delivery is best-effort — see doc comment above.
  }

  return { error: null };
}

/**
 * Bulk twin of notifySignoffRow's per-row logic, batched instead of looped: on a large ITP (this
 * bug was found live on a 465-point ITP with 391 rows still pending) the old version awaited
 * notifySignoffRow — itself several sequential queries — once per row in a for-loop, meaning
 * 1000+ serial round trips in one request. That reliably exceeds a Vercel serverless function's
 * execution timeout, so the button appeared to silently "not work." Fixed by doing the one
 * mutation that actually matters (the status flip) as a single bulk update, then fetching every
 * row's notification/audit context in a handful of batched queries instead of one query per row,
 * and firing the best-effort notification+audit writes concurrently rather than sequentially.
 *
 * Shared by notifyAllPendingForItpAction (manual) and the automation. Only rows still 'pending' are
 * flipped (.eq("status","pending")), so notified_at of an already-notified row is never reset.
 * `opts.automatic` marks the audit summary "(automatic)" and records no human actor.
 */
export async function notifyPendingRowsBulk(
  supabase: Client,
  pending: NotifiableRow[],
  opts: { automatic?: boolean } = {}
): Promise<{ error: boolean }> {
  if (pending.length === 0) return { error: false };
  const pendingIds = pending.map((row) => row.id);
  const { data: flippedRows, error: bulkError } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .update({ status: "notified", notified_at: new Date().toISOString() })
    .in("id", pendingIds)
    .eq("status", "pending")
    .select("id");

  if (bulkError) return { error: true };
  // Only rows this call really flipped get a notification: a concurrent run (manual click, hook or
  // sweep) that got there first has already notified them, so nobody is told twice.
  const flipped = new Set(((flippedRows ?? []) as unknown as { id: string }[]).map((r) => r.id));
  pending = pending.filter((r) => flipped.has(r.id));
  if (pending.length === 0) return { error: false };

  try {
    const uniqueItemIds = [...new Set(pending.map((row) => row.itp_item_id))];
    const uniquePartyIds = [...new Set(pending.map((row) => row.project_party_id))];

    const [{ data: itemContexts }, { data: parties }] = await Promise.all([
      supabase
        .from("itp_items")
        .select("id, activity, itp_sections(itps(id, itp_number, project_id, projects(organization_id)))")
        .in("id", uniqueItemIds)
        .returns<
          {
            id: string;
            activity: string;
            itp_sections: {
              itps: {
                id: string;
                itp_number: string;
                project_id: string;
                projects: { organization_id: string } | null;
              } | null;
            } | null;
          }[]
        >(),
      supabase
        .from("project_parties")
        .select("id, user_id, name")
        .in("id", uniquePartyIds)
        .returns<{ id: string; user_id: string | null; name: string }[]>(),
    ]);

    const itemContextById = new Map((itemContexts ?? []).map((row) => [row.id, row]));
    const partyById = new Map((parties ?? []).map((row) => [row.id, row]));
    const organizationId = itemContexts?.[0]?.itp_sections?.itps?.projects?.organization_id ?? null;

    const { data: levelTypes } = organizationId
      ? await supabase
          .from(INTERVENTION_LEVEL_TYPES_TABLE)
          .select("code, label")
          .eq("organization_id", organizationId)
          .returns<{ code: string; label: string }[]>()
      : { data: null };
    const labelByCode = new Map((levelTypes ?? []).map((row) => [row.code, row.label]));

    let actorId: string | null = null;
    if (!opts.automatic) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      actorId = user?.id ?? null;
    }

    await Promise.all(
      pending.map(async (row) => {
        const itemContext = itemContextById.get(row.itp_item_id);
        const party = partyById.get(row.project_party_id);
        const itp = itemContext?.itp_sections?.itps;
        const rowOrgId = itp?.projects?.organization_id;
        const levelLabel = labelByCode.get(row.intervention) ?? row.intervention;

        if (party?.user_id && itp && rowOrgId) {
          await createNotification(supabase, {
            organizationId: rowOrgId,
            projectId: itp.project_id,
            recipientUserId: party.user_id,
            title: `${levelLabel} sign-off needed`,
            body: `${itp.itp_number} — ${itemContext?.activity ?? "an activity"}`,
            link: `/inspect/itps/${itp.id}`,
          });
        }

        if (itp && rowOrgId) {
          await recordAuditEvent(supabase, {
            organizationId: rowOrgId,
            projectId: itp.project_id,
            entityType: "signoff",
            entityId: row.id,
            action: "notified",
            actorId,
            summary: `${party?.name ?? "Party"} notified of ${levelLabel} sign-off on ${itp.itp_number}${opts.automatic ? " (automatic)" : ""}`,
          });
        }
      })
    );
  } catch {
    // Notification/audit delivery is best-effort — the status update above already succeeded.
  }
  return { error: false };
}
