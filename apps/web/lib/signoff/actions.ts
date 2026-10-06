"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { isTeamLeadForProject } from "@/lib/teams/helpers";
import { isClientTeamLeadForProject } from "@/lib/client-teams/helpers";
import { hasPermission } from "@/lib/rbac/permissions";
import { createNotification } from "@/lib/notifications/helpers";
import { recordAuditEvent } from "@/lib/audit/log";
import {
  ACTIVITY_SIGNOFF_PROGRESS_TABLE,
  DEFAULT_NOTICE_PERIOD_HOURS,
  NOTICE_PERIOD_CONFIGS_TABLE,
  type ActivitySignoffProgressRow,
  type NoticePeriodConfigRow,
} from "./db-types";
import { INTERVENTION_LEVEL_TYPES_TABLE, type InterventionLevelTypeRow } from "@/lib/intervention-levels/types";
import { resolveUnclearedLowerLevel } from "./sequencing";

/** Looks up a level's label/is_blocking, resolving this activity's organisation via
 *  itp_item -> itp_section -> itp -> project -> organization — replaces the old hardcoded
 *  INTERVENTION_LABEL: Record<"H"|"W"|"R"|"S", string> map so a custom level's real label/blocking
 *  behaviour is used everywhere this file used to assume one of the fixed four. */
async function getLevelTypeForItem(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpItemId: string,
  code: string
): Promise<Pick<InterventionLevelTypeRow, "label" | "is_blocking" | "default_notice_hours"> | null> {
  const { data } = await supabase
    .from("itp_items")
    .select("itp_sections(itps(projects(organization_id)))")
    .eq("id", itpItemId)
    .maybeSingle<{ itp_sections: { itps: { projects: { organization_id: string } | null } | null } | null }>();

  const organizationId = data?.itp_sections?.itps?.projects?.organization_id;
  if (!organizationId) return null;

  const { data: levelType } = await supabase
    .from(INTERVENTION_LEVEL_TYPES_TABLE)
    .select("label, is_blocking, default_notice_hours")
    .eq("organization_id", organizationId)
    .eq("code", code)
    .maybeSingle<Pick<InterventionLevelTypeRow, "label" | "is_blocking" | "default_notice_hours">>();

  return levelType ?? null;
}

export interface SignoffActionResult {
  error: string | null;
}

/**
 * Real role-based restriction: a party's sign-off is THEIRS to give, not anyone's on the project.
 * JAGS staff can always countersign on a party's behalf (they run the overall process), but an
 * external user (contractor/subcontractor/TPI/client) may only sign off the specific
 * `project_parties` row their own login is linked to via `project_parties.user_id` — set that link
 * when inviting a party's user, not here. No link yet on a party means nobody but staff can sign it
 * off until one is set.
 *
 * is_active is checked here too now: this used to be a display/record-keeping flag only (see the
 * NOTE in lib/projects/actions.ts's setProjectPartyActive, now out of date), which meant
 * "deactivating" a party never actually revoked its linked user's ability to sign off — it just hid
 * them from lists. Reassignment (reassignSignoffPartyAction below) is the real "someone's out, hand
 * their sign-offs to someone else" path; this is what makes the deactivated party's own login stop
 * working in the meantime, rather than leaving it silently live.
 */
async function canSignOffForParty(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectPartyId: string
): Promise<boolean> {
  const session = await requireSession();
  if (session.isJagsStaff) return true;

  const { data: party } = await supabase
    .from("project_parties")
    .select("user_id, is_active")
    .eq("id", projectPartyId)
    .maybeSingle<{ user_id: string | null; is_active: boolean }>();

  return party?.is_active === true && party?.user_id === session.userId;
}

/** Looks up the ITP id for a sign-off progress row's activity, to revalidate its detail page. */
async function findItpIdForProgress(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpItemId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("itp_items")
    .select("itp_sections(itp_id)")
    .eq("id", itpItemId)
    .maybeSingle<{ itp_sections: { itp_id: string } | null }>();
  return data?.itp_sections?.itp_id ?? null;
}

/**
 * Shared notify logic used by both the single-row Notify button (notifyPartyAction) and the
 * "Notify all pending" bulk action (notifyAllPendingForItpAction) below — marks the row notified and
 * delivers a real in-app notification to that party's linked user (project_parties.user_id),
 * replacing what used to be a pure timestamp with no actual delivery. Best-effort: a party with no
 * linked login yet (set up in advance of that user's account existing, a legitimate real-world
 * ordering) simply gets no notification row — the notified_at timestamp is still the source of truth
 * for the notice-period clock either way, so delivery failures never block the status update. Does
 * NOT revalidate the page itself — callers do that once, after all rows they touch are done.
 */
async function notifySignoffRow(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  progress: Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "project_party_id" | "intervention" | "status">
): Promise<SignoffActionResult> {
  // Only an open (pending/notified) row can be (re-)notified — never reopen a signed-off or
  // proceeded row. select() lets us detect 0 rows affected (already cleared by someone else).
  const { data: updated, error } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .update({ status: "notified", notified_at: new Date().toISOString() })
    .eq("id", progress.id)
    .in("status", ["pending", "notified"])
    .select("id");

  if (!error && (!updated || updated.length === 0)) {
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

    if (party?.user_id && itp && organizationId) {
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
        action: "notified",
        actorId: user?.id ?? null,
        summary: `${party?.name ?? "Party"} notified of ${levelLabel ?? progress.intervention} sign-off on ${itp.itp_number}`,
      });
    }
  } catch {
    // Notification delivery is best-effort — see doc comment above.
  }

  return { error: null };
}

/**
 * Marks a party notified of a pending Hold/Witness/Review/Surveillance sign-off. Thin wrapper around
 * notifySignoffRow for the single-row Notify button — see that function's doc comment for what it
 * actually does.
 */
export async function notifyPartyAction(progressId: string): Promise<SignoffActionResult> {
  if (!progressId) return { error: "Missing sign-off record." };

  const supabase = await createSupabaseServerClient();

  const { data: progress } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .select("id, itp_item_id, project_party_id, intervention, status")
    .eq("id", progressId)
    .maybeSingle<
      Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "project_party_id" | "intervention" | "status">
    >();

  if (!progress) return { error: "Sign-off record not found." };

  // R66-R81: notifying a party of a pending sign-off is that party's own step to trigger (or
  // JAGS staff's, who run the overall process) — not any other party's on the project. Previously
  // ungated, so any logged-in viewer with project access could click Notify on any other party's
  // cell. Mirrors canSignOffForParty's exact rule, reused here rather than duplicated.
  const canNotify = await canSignOffForParty(supabase, progress.project_party_id);
  if (!canNotify) return { error: "Only this party's own login (or JAGS staff) can notify them." };

  const result = await notifySignoffRow(supabase, progress);
  if (result.error) return result;

  const itpId = await findItpIdForProgress(supabase, progress.itp_item_id);
  if (itpId) revalidatePath(`/inspect/itps/${itpId}`);
  revalidatePath("/inspect");
  return { error: null };
}

/**
 * Bulk twin of notifyPartyAction: notifies every activity_signoff_progress row still 'pending' for
 * this ITP in one click, instead of one Notify click per row — the end-to-end walkthrough found
 * doing this row-by-row too slow for a JAGS admin managing several ITPs. JAGS-staff only, mirroring
 * this page's other staff-only actions (matches canEditContent's gating in page.tsx). Calls the same
 * notifySignoffRow used by the single-row action above for every row, so notification-sending logic
 * lives in exactly one place.
 */
export async function notifyAllPendingForItpAction(formData: FormData): Promise<void> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  if (!itpId) return;

  const session = await requireSession();
  if (!session.isJagsStaff) return;

  const supabase = await createSupabaseServerClient();

  const { data: sections } = await supabase
    .from("itp_sections")
    .select("itp_items(id)")
    .eq("itp_id", itpId)
    .returns<{ itp_items: { id: string }[] }[]>();

  const itemIds = (sections ?? []).flatMap((s) => (s.itp_items ?? []).map((i) => i.id));

  if (itemIds.length > 0) {
    const { data: pending } = await supabase
      .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
      .select("id, itp_item_id, project_party_id, intervention, status")
      .in("itp_item_id", itemIds)
      .eq("status", "pending")
      .returns<
        Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "project_party_id" | "intervention" | "status">[]
      >();

    // Bulk twin of notifySignoffRow's per-row logic, batched instead of looped: on a large ITP (this
    // bug was found live on a 465-point ITP with 391 rows still pending) the old version awaited
    // notifySignoffRow — itself several sequential queries — once per row in a for-loop, meaning
    // 1000+ serial round trips in one request. That reliably exceeds a Vercel serverless function's
    // execution timeout, so the button appeared to silently "not work." Fixed by doing the one
    // mutation that actually matters (the status flip) as a single bulk update, then fetching every
    // row's notification/audit context in a handful of batched queries instead of one query per row,
    // and firing the best-effort notification+audit writes concurrently rather than sequentially.
    if (pending && pending.length > 0) {
      const pendingIds = pending.map((row) => row.id);
      const { error: bulkError } = await supabase
        .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
        .update({ status: "notified", notified_at: new Date().toISOString() })
        .in("id", pendingIds);

      if (!bulkError) {
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

          const {
            data: { user },
          } = await supabase.auth.getUser();

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
                  actorId: user?.id ?? null,
                  summary: `${party?.name ?? "Party"} notified of ${levelLabel} sign-off on ${itp.itp_number}`,
                });
              }
            })
          );
        } catch {
          // Notification/audit delivery is best-effort — the status update above already succeeded.
        }
      }
    }
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  revalidatePath("/inspect");
}

/**
 * Every blocking level configured with a lower sort_order than `code` (this activity's own
 * organisation's intervention_level_types) must already be cleared (signed off or proceeded)
 * before `code` itself can be signed off — makes sort_order a real hierarchy/sequence rather than
 * just a display order, so an org that configures more than one blocking level (e.g. a client's own
 * internal review before JAGS's Hold) gets a genuine ordered chain. A no-op for every org still on
 * the seeded default (only "H" is_blocking=true there), so this changes nothing for existing data —
 * it only activates once an org deliberately adds a second blocking level via
 * addInterventionLevelAction. Returns null when clear to proceed, or the blocking level's label.
 *
 * R67 (strict vs. flexible sequencing, organizations.itp_sequencing_mode): the above is exactly
 * today's default 'flexible' behaviour — only blocking levels enforce order among themselves,
 * non-blocking levels (Witness/Review/Surveillance) are free-for-all. When an org has switched to
 * 'strict', EVERY level with a lower sort_order (blocking or not) must clear first, not just
 * blocking ones — so a non-blocking Witness at sort_order 0 must be signed off before a non-blocking
 * Review at sort_order 1 can be, exactly as if both were blocking. Kept as one function (rather than
 * splitting it) since the two modes differ only in which levels count as "must clear first" — the
 * "is anything uncleared" logic below is identical either way. Deliberately not renamed: its
 * call site in signOffAction stays untouched, and the name still reads fine for the common
 * (flexible/blocking-only) case.
 */
async function findUnclearedLowerBlockingLevel(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpItemId: string,
  code: string
): Promise<string | null> {
  const { data: itemContext } = await supabase
    .from("itp_items")
    .select("itp_sections(itps(projects(organization_id)))")
    .eq("id", itpItemId)
    .maybeSingle<{ itp_sections: { itps: { projects: { organization_id: string } | null } | null } | null }>();
  const organizationId = itemContext?.itp_sections?.itps?.projects?.organization_id;
  if (!organizationId) return null;

  const { data: org } = await supabase
    .from("organizations")
    .select("itp_sequencing_mode")
    .eq("id", organizationId)
    .maybeSingle<{ itp_sequencing_mode: string }>();
  const strictMode = org?.itp_sequencing_mode === "strict";

  const { data: levels } = await supabase
    .from(INTERVENTION_LEVEL_TYPES_TABLE)
    .select("code, label, sort_order, is_blocking")
    .eq("organization_id", organizationId)
    .returns<Pick<InterventionLevelTypeRow, "code" | "label" | "sort_order" | "is_blocking">[]>();

  const { data: priorRows } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .select("intervention, status")
    .eq("itp_item_id", itpItemId)
    .returns<Pick<ActivitySignoffProgressRow, "intervention" | "status">[]>();

  return resolveUnclearedLowerLevel(levels ?? [], code, strictMode, priorRows ?? []);
}

/** Records sign-off. Valid for any intervention level, regardless of whether it was ever notified. */
export async function signOffAction(progressId: string): Promise<SignoffActionResult> {
  if (!progressId) return { error: "Missing sign-off record." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: progress } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .select("id, itp_item_id, project_party_id, intervention")
    .eq("id", progressId)
    .maybeSingle<Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "project_party_id" | "intervention">>();

  if (!progress) return { error: "Sign-off record not found." };

  if (!(await canSignOffForParty(supabase, progress.project_party_id))) {
    return { error: "You can only sign off on behalf of your own party on this project." };
  }

  // Approval before work: activity sign-offs only count on an ITP that has been approved (or accepted).
  {
    const signoffItpId = await findItpIdForProgress(supabase, progress.itp_item_id);
    if (signoffItpId) {
      const { data: signoffItp } = await supabase.from("itps").select("status").eq("id", signoffItpId).maybeSingle<{ status: string }>();
      if (signoffItp && signoffItp.status !== "approved" && signoffItp.status !== "client_accepted") {
        return { error: "This ITP hasn't been approved yet, so activities can't be signed off. Sign-off opens once it is approved." };
      }
    }
  }

  const blockedByLevel = await findUnclearedLowerBlockingLevel(supabase, progress.itp_item_id, progress.intervention);
  if (blockedByLevel) {
    return { error: `${blockedByLevel} must be signed off (or proceeded without response) before this level can be.` };
  }

  const { data: signedRows, error } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .update({
      status: "signed_off",
      signed_off_at: new Date().toISOString(),
      signed_off_by: user?.id ?? null,
    })
    .eq("id", progressId)
    .neq("status", "signed_off")
    .select("id");

  if (!error && (!signedRows || signedRows.length === 0)) {
    // Double click / second user: already signed, never overwrite the original signer + time.
    return { error: "This was already signed off." };
  }

  if (error) {
    console.error(`[signoff] signOffAction failed for progress ${progressId} (user ${user?.id ?? "unknown"}):`, error);
    return { error: "Could not record sign-off. Check you have permission and try again." };
  }

  const itpId = await findItpIdForProgress(supabase, progress.itp_item_id);
  if (itpId) revalidatePath(`/inspect/itps/${itpId}`);
  revalidatePath("/inspect");

  // Best-effort: the audit trail is a convenience layer on top of the real, already-succeeded
  // sign-off above — see lib/audit/log.ts's doc comment.
  try {
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

    if (itp && organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId: itp.project_id,
        entityType: "signoff",
        entityId: progressId,
        action: "signed_off",
        actorId: user?.id ?? null,
        summary: `${levelLabel ?? progress.intervention} sign-off recorded on ${itp.itp_number} — ${context?.activity ?? "an activity"}`,
      });
    }
  } catch {
    // Best-effort — see doc comment above.
  }

  return { error: null };
}

/**
 * Lets a non-blocking-level activity (Witness by default, or any other level an organisation has
 * configured as is_blocking=false — see intervention_level_types) proceed without a response once
 * its notice period has elapsed (R66-R81: unlike a Hold, a non-blocking level never blocks progress
 * indefinitely). Rejected for anything other than a notified, non-blocking level whose notice period
 * has actually passed.
 */
export async function proceedWithoutResponseAction(progressId: string, reason?: string): Promise<SignoffActionResult> {
  if (!progressId) return { error: "Missing sign-off record." };
  const cleanReason = (reason ?? "").trim();
  if (cleanReason.length < 5) {
    return { error: "Give a reason (at least 5 characters) for proceeding without a response." };
  }

  // Proceeding without a response is the originator's (JAGS's) discretion call, not any party's —
  // previously ungated here, so the very party that failed to respond (or an unrelated third party)
  // could click it once the notice period elapsed. Mirrors canSignOffForParty's restriction above.
  const session = await requireSession();
  if (!session.isJagsStaff) {
    return { error: "Only JAGS staff can proceed without a response." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: progress } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .select("id, itp_item_id, intervention, status, notified_at")
    .eq("id", progressId)
    .maybeSingle<
      Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "intervention" | "status" | "notified_at">
    >();

  if (!progress) return { error: "Sign-off record not found." };

  const levelType = await getLevelTypeForItem(supabase, progress.itp_item_id, progress.intervention);
  if (!levelType || levelType.is_blocking) {
    return { error: "Only a non-blocking level (e.g. Witness) can proceed without a response." };
  }
  if (progress.status !== "notified" || !progress.notified_at) {
    return { error: "The party must be notified before proceeding without a response." };
  }

  const projectId = await findProjectIdForItpItem(supabase, progress.itp_item_id);
  const noticeHours = await getNoticePeriodHours(supabase, projectId, progress.itp_item_id, progress.intervention);
  const noticeExpiresAt = new Date(progress.notified_at).getTime() + noticeHours * 60 * 60 * 1000;

  if (Date.now() < noticeExpiresAt) {
    return { error: "The notice period has not elapsed yet." };
  }

  const { data: proceededRows, error } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .update({
      status: "proceeded_no_response",
      proceeded_reason: `Party notified ${progress.notified_at}; no response within ${noticeHours}h notice period. Reason: ${cleanReason}`,
      proceeded_at: new Date().toISOString(),
    })
    .eq("id", progressId)
    .eq("status", "notified")
    .select("id");

  if (!error && (!proceededRows || proceededRows.length === 0)) {
    return { error: "This sign-off changed in the meantime. Refresh and check its status." };
  }

  if (error) {
    console.error(`[signoff] proceedWithoutResponseAction failed for progress ${progressId}:`, error);
    return { error: "Could not proceed. Check you have permission and try again." };
  }

  const itpId = await findItpIdForProgress(supabase, progress.itp_item_id);
  if (itpId) revalidatePath(`/inspect/itps/${itpId}`);
  revalidatePath("/inspect");

  // R102: a party being skipped past (even legitimately, per R72-74's own "record it clearly" rule)
  // is exactly the kind of event this trail exists for — best-effort, never blocks the already-
  // succeeded proceed above.
  try {
    const { data: context } = await supabase
      .from("itp_items")
      .select("activity, itp_sections(itps(itp_number, project_id, projects(organization_id)))")
      .eq("id", progress.itp_item_id)
      .maybeSingle<{
        activity: string;
        itp_sections: { itps: { itp_number: string; project_id: string; projects: { organization_id: string } | null } | null } | null;
      }>();
    const itp = context?.itp_sections?.itps;
    const organizationId = itp?.projects?.organization_id;
    if (itp && organizationId) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await recordAuditEvent(supabase, {
        organizationId,
        projectId: itp.project_id,
        entityType: "signoff",
        entityId: progressId,
        action: "proceeded_no_response",
        actorId: user?.id ?? null,
        summary: `Proceeded without response on ${itp.itp_number} — ${context?.activity ?? "an activity"}`,
      });
    }
  } catch {
    // Best-effort — see doc comment above.
  }

  return { error: null };
}

/**
 * True only when every blocking-level (Hold-equivalent, per this activity's organisation's own
 * intervention_level_types.is_blocking) row on the activity has been signed off, or there are no
 * blocking rows at all — false while any is still pending (R71: "a hold point must wait").
 *
 * Checked at TWO points, not one: startInspectionAction (lib/checklists/actions.ts) — so the Hold
 * actually holds the physical work itself, not just the paperwork — and completeInspectionCore, as
 * a second check in case a Hold got added after the inspection was already started. Non-blocking
 * levels (Witness/Review/Surveillance, R72-R73) never appear here — they're notify-and-proceed by
 * definition and never hold anything.
 */
export async function canCompleteInspection(itpItemId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();

  const { data: itemContext } = await supabase
    .from("itp_items")
    .select("itp_sections(itps(projects(organization_id)))")
    .eq("id", itpItemId)
    .maybeSingle<{ itp_sections: { itps: { projects: { organization_id: string } | null } | null } | null }>();

  const organizationId = itemContext?.itp_sections?.itps?.projects?.organization_id;
  if (!organizationId) return true;

  const { data: blockingLevels } = await supabase
    .from(INTERVENTION_LEVEL_TYPES_TABLE)
    .select("code")
    .eq("organization_id", organizationId)
    .eq("is_blocking", true)
    .returns<{ code: string }[]>();

  const blockingCodes = (blockingLevels ?? []).map((l) => l.code);
  if (blockingCodes.length === 0) return true;

  const { data: holds } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .select("status")
    .eq("itp_item_id", itpItemId)
    .in("intervention", blockingCodes)
    .returns<Pick<ActivitySignoffProgressRow, "status">[]>();

  return (holds ?? []).every((h) => h.status === "signed_off");
}

async function findProjectIdForItpItem(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpItemId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("itp_items")
    .select("itp_sections(itps(project_id))")
    .eq("id", itpItemId)
    .maybeSingle<{ itp_sections: { itps: { project_id: string } | null } | null }>();
  return data?.itp_sections?.itps?.project_id ?? null;
}

export interface ReassignPartyState {
  error: string | null;
}

/**
 * The practical "someone's out, hand their responsibility to someone else" mechanism: repoints
 * which user is linked to a project_party (project_parties.user_id) — the same column
 * canSignOffForParty above gates sign-off on. Deliberately does not add new delegation schema; this
 * is the simplest correct primitive that unblocks a stuck sign-off (see this file's doc comment on
 * canSignOffForParty for why an absent linked user otherwise blocks the chain indefinitely).
 *
 * RLS (project_parties_staff_write) already allows ANY JAGS staff to update this column — this
 * action deliberately narrows that to a JAGS Admin, or a lead of a team actually assigned to this
 * party's project, checked here explicitly rather than relying on RLS alone, since reassigning who
 * can sign off on a party's behalf is a sensitive capability that shouldn't be left to "any
 * inspector with project access."
 */
export async function reassignSignoffPartyAction(
  _prev: ReassignPartyState,
  formData: FormData
): Promise<ReassignPartyState> {
  const projectPartyId = String(formData.get("project_party_id") ?? "").trim();
  const newUserId = String(formData.get("new_user_id") ?? "").trim();
  if (!projectPartyId || !newUserId) return { error: "Missing party or new user." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: party } = await supabase
    .from("project_parties")
    .select("id, project_id, party_type")
    .eq("id", projectPartyId)
    .maybeSingle<{ id: string; project_id: string; party_type: string }>();

  if (!party) return { error: "Party not found." };

  // Custom RBAC (CEO ask): a project-scoped or org-wide "reassign_project_party" grant is an
  // additional allow-path alongside Admin/team-lead — never a replacement (see
  // lib/rbac/permissions.ts). project_parties_write RLS (20260918020000_custom_rbac.sql) mirrors this
  // exact check, so a grant here isn't silently rejected at the database layer.
  //
  // A client team's own lead can do the same, but only for a party_type='client' row on a project
  // their team is actually assigned to (client_team_project_assignments) — the client-org analogue
  // of a JAGS team lead's reach, restricted to their own client-side people rather than every party
  // on the project (a client team lead reassigning a subcontractor's sign-off would be out of
  // scope). This is what gives "Assign [client team] to project" (client-teams/page.tsx) a real
  // effect — see isClientTeamLeadForProject's own doc comment.
  const allowed =
    isAdminStaff(session) ||
    (await isTeamLeadForProject(supabase, session.userId, party.project_id)) ||
    (party.party_type === "client" && (await isClientTeamLeadForProject(supabase, session.userId, party.project_id))) ||
    (await hasPermission(session.userId, "reassign_project_party", party.project_id));
  if (!allowed) {
    return {
      error:
        "Only a JAGS Admin, a lead of a team assigned to this project, a lead of a client team assigned to this project (for their own client-side parties), or someone granted this permission, can reassign a party.",
    };
  }

  const { data: partyWithType, error: fetchTypeError } = await supabase
    .from("project_parties")
    .select("party_type, projects(organization_id)")
    .eq("id", projectPartyId)
    .maybeSingle<{ party_type: string; projects: { organization_id: string } | null }>();

  // Real gap found in audit: the reassignment update below used to run unconditionally even when
  // this fetch failed — the party's user_id would get repointed, but the access-grant insert further
  // down (gated on `!fetchTypeError`) would silently never run, quietly reintroducing the exact
  // "linked but no access" bug the comment on that insert says this whole action exists to fix.
  // Abort before the write instead of after, so a fetch failure can never leave that split state.
  if (fetchTypeError) {
    console.error(`[signoff] reassignSignoffPartyAction: could not resolve party type for ${projectPartyId}:`, fetchTypeError);
    return { error: "Could not reassign the party. Check you have permission and try again." };
  }

  // The new login must be a real, active user — never repoint a party at a deactivated or unknown id.
  const { data: newUser } = await supabase
    .from("users")
    .select("id, is_active")
    .eq("id", newUserId)
    .maybeSingle<{ id: string; is_active: boolean }>();
  if (!newUser || newUser.is_active === false) {
    return { error: "That user doesn't exist or is deactivated, so the party can't be reassigned to them." };
  }

  const { data: previousLink } = await supabase
    .from("project_parties")
    .select("user_id, name")
    .eq("id", projectPartyId)
    .maybeSingle<{ user_id: string | null; name: string }>();
  const previousUserId = previousLink?.user_id ?? null;

  const { error } = await supabase
    .from("project_parties")
    .update({ user_id: newUserId })
    .eq("id", projectPartyId);

  if (error) {
    console.error(`[signoff] reassignSignoffPartyAction failed for party ${projectPartyId} -> user ${newUserId}:`, error);
    return { error: "Could not reassign the party. Check you have permission and try again." };
  }

  // Real bug fix: linking a login here (project_parties.user_id) was never actually granting that
  // login any platform access — has_org_access()/has_project_access() (the RLS gate on nearly every
  // table, including who shows up as an eligible Client Team member) only ever look at
  // access_grants, never at project_parties.user_id. addSelfManagedPartyAction already creates both
  // rows together for exactly this reason; this was the one path that linked a login without ever
  // granting the access that link implies. Best-effort + ignore-duplicate: a user who already has a
  // broader (global/organisation) grant just gets a harmless redundant project-scoped row, and a
  // second reassignment to the same user hits the unique partial index
  // (access_grants_one_per_project_per_user) rather than erroring the whole action.
  if (!fetchTypeError && partyWithType?.projects?.organization_id) {
    const { error: grantError } = await supabase.from("access_grants").insert({
      user_id: newUserId,
      scope_type: "project",
      organization_id: partyWithType.projects.organization_id,
      project_id: party.project_id,
      role: partyWithType.party_type,
    });
    if (grantError && grantError.code !== "23505") {
      return {
        error:
          "The party was reassigned, but granting platform access to the new login failed — check with a JAGS Admin.",
      };
    }

    // R102: who now signs off on a party's behalf is exactly the kind of access-relevant change an
    // audit trail exists for — best-effort, never blocks the reassignment that already succeeded.
    try {
      await recordAuditEvent(supabase, {
        organizationId: partyWithType.projects.organization_id,
        projectId: party.project_id,
        entityType: "project_party",
        entityId: projectPartyId,
        action: "reassigned",
        actorId: session.userId,
        summary: `Reassigned party ${projectPartyId} to a new linked login`,
        changes: { new_user_id: newUserId },
      });
    } catch {
      // Best-effort — see recordAuditEvent's own doc comment.
    }
  }

  // Take the previous login's project access away (only when it isn't still linked to another party
  // on this project) and tell both people. Best-effort: the reassignment itself already succeeded.
  if (partyWithType?.projects?.organization_id) {
    const organizationId = partyWithType.projects.organization_id;
    try {
      if (previousUserId && previousUserId !== newUserId) {
        const { count: stillLinked } = await supabase
          .from("project_parties")
          .select("id", { count: "exact", head: true })
          .eq("project_id", party.project_id)
          .eq("user_id", previousUserId);
        if (!stillLinked) {
          await supabase
            .from("access_grants")
            .delete()
            .eq("user_id", previousUserId)
            .eq("scope_type", "project")
            .eq("project_id", party.project_id)
            .eq("role", partyWithType.party_type);
        }
        await createNotification(supabase, {
          organizationId,
          projectId: party.project_id,
          recipientUserId: previousUserId,
          title: "You've been replaced on a project party",
          body: `${previousLink?.name ?? "A party"} on this project is now linked to someone else.`,
          link: `/inspect/projects/${party.project_id}`,
        });
      }
      await createNotification(supabase, {
        organizationId,
        projectId: party.project_id,
        recipientUserId: newUserId,
        title: "You've been linked to a project party",
        body: `You now act for ${previousLink?.name ?? "a party"} on this project.`,
        link: `/inspect/projects/${party.project_id}`,
      });
    } catch {
      // Best-effort.
    }
  }

  revalidatePath(`/inspect/projects/${party.project_id}`);
  return { error: null };
}

/**
 * Precedence, highest first: R25's per-activity notice_hours_override on the item itself, then a
 * project-level notice_period_configs override, then this organisation's own configured
 * default_notice_hours for that level (intervention_level_types), then the original hardcoded spec
 * fallback (Hold=48h/Witness=24h, DEFAULT_NOTICE_PERIOD_HOURS) for the two levels that ever had one.
 * Same fallback chain the app always had, just with the new item-level tier on top and no longer
 * restricted to literal "H"/"W" codes — a custom level with its own default_notice_hours now
 * participates in the level tier too.
 */
async function getNoticePeriodHours(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string | null,
  itpItemId: string,
  intervention: string
): Promise<number> {
  const { data: item } = await supabase
    .from("itp_items")
    .select("notice_hours_override")
    .eq("id", itpItemId)
    .maybeSingle<{ notice_hours_override: number | null }>();
  if (item?.notice_hours_override != null) return item.notice_hours_override;

  if (projectId) {
    const { data: config } = await supabase
      .from(NOTICE_PERIOD_CONFIGS_TABLE)
      .select("hours")
      .eq("project_id", projectId)
      .eq("intervention", intervention)
      .maybeSingle<Pick<NoticePeriodConfigRow, "hours">>();

    if (config?.hours != null) return config.hours;
  }

  const levelType = await getLevelTypeForItem(supabase, itpItemId, intervention);
  if (levelType?.default_notice_hours != null) return levelType.default_notice_hours;

  return DEFAULT_NOTICE_PERIOD_HOURS[intervention] ?? 24;
}

/**
 * Withdraws a recorded sign-off (or proceed-without-response), returning the row to Pending.
 * Industry practice: a signed Hold is never silently reversible — JAGS staff only, a written
 * reason is mandatory, and the original signer/time/reason are preserved in the audit trail.
 */
export async function withdrawSignoffAction(progressId: string, reason: string): Promise<SignoffActionResult> {
  if (!progressId) return { error: "Missing sign-off record." };
  const cleanReason = (reason ?? "").trim();
  if (cleanReason.length < 5) return { error: "Give a reason (at least 5 characters) for withdrawing this sign-off." };

  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can withdraw a recorded sign-off." };

  const supabase = await createSupabaseServerClient();
  const { data: progress } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .select("id, itp_item_id, intervention, status, signed_off_at, signed_off_by, proceeded_reason")
    .eq("id", progressId)
    .maybeSingle<
      Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "intervention" | "status" | "signed_off_at" | "signed_off_by" | "proceeded_reason">
    >();
  if (!progress) return { error: "Sign-off record not found." };
  if (progress.status !== "signed_off" && progress.status !== "proceeded_no_response") {
    return { error: "Only a recorded sign-off can be withdrawn." };
  }

  const { data: rows, error } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .update({
      status: "pending",
      notified_at: null,
      signed_off_at: null,
      signed_off_by: null,
      proceeded_reason: null,
      proceeded_at: null,
    })
    .eq("id", progressId)
    .eq("status", progress.status)
    .select("id");
  if (error) {
    console.error(`[signoff] withdrawSignoffAction failed for ${progressId}:`, error);
    return { error: "Could not withdraw the sign-off. Check you have permission and try again." };
  }
  if (!rows || rows.length === 0) return { error: "This sign-off changed in the meantime. Refresh and try again." };

  try {
    const { data: context } = await supabase
      .from("itp_items")
      .select("activity, itp_sections(itps(itp_number, project_id, projects(organization_id)))")
      .eq("id", progress.itp_item_id)
      .maybeSingle<{
        activity: string;
        itp_sections: { itps: { itp_number: string; project_id: string; projects: { organization_id: string } | null } | null } | null;
      }>();
    const itp = context?.itp_sections?.itps;
    const organizationId = itp?.projects?.organization_id;
    if (itp && organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId: itp.project_id,
        entityType: "signoff",
        entityId: progressId,
        action: "withdrawn",
        actorId: session.userId,
        summary: `${progress.intervention} sign-off withdrawn on ${itp.itp_number} — ${context?.activity ?? "an activity"}. Reason: ${cleanReason}`,
        changes: {
          previous_status: progress.status,
          previous_signed_off_at: progress.signed_off_at,
          previous_signed_off_by: progress.signed_off_by,
          previous_proceeded_reason: progress.proceeded_reason,
          reason: cleanReason,
        },
      });
    }
  } catch {
    // Best-effort audit.
  }

  const itpId = await findItpIdForProgress(supabase, progress.itp_item_id);
  if (itpId) revalidatePath(`/inspect/itps/${itpId}`);
  revalidatePath("/inspect");
  return { error: null };
}
