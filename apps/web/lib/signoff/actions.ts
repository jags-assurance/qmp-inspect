"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { isTeamLeadForProject } from "@/lib/teams/helpers";
import { createNotification } from "@/lib/notifications/helpers";
import {
  ACTIVITY_SIGNOFF_PROGRESS_TABLE,
  DEFAULT_NOTICE_PERIOD_HOURS,
  NOTICE_PERIOD_CONFIGS_TABLE,
  type ActivitySignoffProgressRow,
  type NoticePeriodConfigRow,
} from "./db-types";
import { INTERVENTION_LEVEL_TYPES_TABLE, type InterventionLevelTypeRow } from "@/lib/intervention-levels/types";

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
 */
async function canSignOffForParty(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectPartyId: string
): Promise<boolean> {
  const session = await requireSession();
  if (session.isJagsStaff) return true;

  const { data: party } = await supabase
    .from("project_parties")
    .select("user_id")
    .eq("id", projectPartyId)
    .maybeSingle<{ user_id: string | null }>();

  return party?.user_id === session.userId;
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
  const { error } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .update({ status: "notified", notified_at: new Date().toISOString() })
    .eq("id", progress.id);

  if (error) return { error: "Could not notify the party. Check you have permission and try again." };

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

    if (party?.user_id && itp && organizationId) {
      const { data: levelType } = await supabase
        .from(INTERVENTION_LEVEL_TYPES_TABLE)
        .select("label")
        .eq("organization_id", organizationId)
        .eq("code", progress.intervention)
        .maybeSingle<{ label: string }>();

      await createNotification(supabase, {
        organizationId,
        projectId: itp.project_id,
        recipientUserId: party.user_id,
        title: `${levelType?.label ?? progress.intervention} sign-off needed`,
        body: `${itp.itp_number} — ${context?.activity ?? "an activity"}`,
        link: itpId ? `/inspect/itps/${itpId}` : null,
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

    for (const row of pending ?? []) {
      await notifySignoffRow(supabase, row);
    }
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  revalidatePath("/inspect");
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
    .select("id, itp_item_id, project_party_id")
    .eq("id", progressId)
    .maybeSingle<Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "project_party_id">>();

  if (!progress) return { error: "Sign-off record not found." };

  if (!(await canSignOffForParty(supabase, progress.project_party_id))) {
    return { error: "You can only sign off on behalf of your own party on this project." };
  }

  const { error } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .update({
      status: "signed_off",
      signed_off_at: new Date().toISOString(),
      signed_off_by: user?.id ?? null,
    })
    .eq("id", progressId);

  if (error) return { error: "Could not record sign-off. Check you have permission and try again." };

  const itpId = await findItpIdForProgress(supabase, progress.itp_item_id);
  if (itpId) revalidatePath(`/inspect/itps/${itpId}`);
  revalidatePath("/inspect");
  return { error: null };
}

/**
 * Lets a non-blocking-level activity (Witness by default, or any other level an organisation has
 * configured as is_blocking=false — see intervention_level_types) proceed without a response once
 * its notice period has elapsed (R66-R81: unlike a Hold, a non-blocking level never blocks progress
 * indefinitely). Rejected for anything other than a notified, non-blocking level whose notice period
 * has actually passed.
 */
export async function proceedWithoutResponseAction(progressId: string): Promise<SignoffActionResult> {
  if (!progressId) return { error: "Missing sign-off record." };

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

  const { error } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .update({
      status: "proceeded_no_response",
      proceeded_reason: `Party notified ${progress.notified_at}; no response within notice period; proceeded at originator's discretion.`,
    })
    .eq("id", progressId);

  if (error) return { error: "Could not proceed. Check you have permission and try again." };

  const itpId = await findItpIdForProgress(supabase, progress.itp_item_id);
  if (itpId) revalidatePath(`/inspect/itps/${itpId}`);
  revalidatePath("/inspect");
  return { error: null };
}

/**
 * Blocks inspection completion until every blocking-level (Hold-equivalent, per this activity's
 * organisation's own intervention_level_types.is_blocking) row on the activity has been signed off
 * (R66-R81: a non-blocking level never blocks). True when there are no blocking rows at all.
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
    .select("id, project_id")
    .eq("id", projectPartyId)
    .maybeSingle<{ id: string; project_id: string }>();

  if (!party) return { error: "Party not found." };

  const allowed = isAdminStaff(session) || (await isTeamLeadForProject(supabase, session.userId, party.project_id));
  if (!allowed) {
    return { error: "Only a JAGS Admin, or a lead of a team assigned to this project, can reassign a party." };
  }

  const { error } = await supabase
    .from("project_parties")
    .update({ user_id: newUserId })
    .eq("id", projectPartyId);

  if (error) return { error: "Could not reassign the party. Check you have permission and try again." };

  revalidatePath(`/inspect/projects/${party.project_id}`);
  return { error: null };
}

/**
 * Precedence, highest first: a project-level notice_period_configs override, then this
 * organisation's own configured default_notice_hours for that level (intervention_level_types),
 * then the original hardcoded spec fallback (Hold=48h/Witness=24h, DEFAULT_NOTICE_PERIOD_HOURS) for
 * the two levels that ever had one. Same three-tier fallback the app always had, just no longer
 * restricted to literal "H"/"W" codes — a custom level with its own default_notice_hours now
 * participates in the middle tier too.
 */
async function getNoticePeriodHours(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string | null,
  itpItemId: string,
  intervention: string
): Promise<number> {
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
