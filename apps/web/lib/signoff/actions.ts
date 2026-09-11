"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import {
  ACTIVITY_SIGNOFF_PROGRESS_TABLE,
  DEFAULT_NOTICE_PERIOD_HOURS,
  NOTICE_PERIOD_CONFIGS_TABLE,
  type ActivitySignoffProgressRow,
  type NoticePeriodConfigRow,
} from "./db-types";

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
 * Marks a party notified of a pending Hold/Witness/Review/Surveillance sign-off. Real notification
 * delivery (email/push) is a future integration point — this only records that the notice went out.
 */
export async function notifyPartyAction(progressId: string): Promise<SignoffActionResult> {
  if (!progressId) return { error: "Missing sign-off record." };

  const supabase = await createSupabaseServerClient();

  const { data: progress } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .select("id, itp_item_id, status")
    .eq("id", progressId)
    .maybeSingle<Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "status">>();

  if (!progress) return { error: "Sign-off record not found." };

  const { error } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .update({ status: "notified", notified_at: new Date().toISOString() })
    .eq("id", progressId);

  if (error) return { error: "Could not notify the party. Check you have permission and try again." };

  const itpId = await findItpIdForProgress(supabase, progress.itp_item_id);
  if (itpId) revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
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
  return { error: null };
}

/**
 * Lets a Witness activity proceed without a response once its notice period has elapsed (R66-R81:
 * unlike a Hold, a Witness never blocks progress indefinitely). Rejected for anything other than a
 * notified Witness whose notice period has actually passed.
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
  if (progress.intervention !== "W") return { error: "Only a Witness sign-off can proceed without a response." };
  if (progress.status !== "notified" || !progress.notified_at) {
    return { error: "The party must be notified before proceeding without a response." };
  }

  const projectId = await findProjectIdForItpItem(supabase, progress.itp_item_id);
  const noticeHours = await getNoticePeriodHours(supabase, projectId, "W");
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
  return { error: null };
}

/**
 * Blocks inspection completion until every Hold on the activity has been signed off (R66-R81:
 * Witness/Review/Surveillance never block). True when there are no Hold rows at all.
 */
export async function canCompleteInspection(itpItemId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();

  const { data: holds } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .select("status")
    .eq("itp_item_id", itpItemId)
    .eq("intervention", "H")
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

async function getNoticePeriodHours(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string | null,
  intervention: "H" | "W"
): Promise<number> {
  if (!projectId) return DEFAULT_NOTICE_PERIOD_HOURS[intervention];

  const { data: config } = await supabase
    .from(NOTICE_PERIOD_CONFIGS_TABLE)
    .select("hours")
    .eq("project_id", projectId)
    .eq("intervention", intervention)
    .maybeSingle<Pick<NoticePeriodConfigRow, "hours">>();

  return config?.hours ?? DEFAULT_NOTICE_PERIOD_HOURS[intervention];
}
