// R79 extension: project-wide, ordered, multi-person ITP review chain — see the migration's own
// header comment (20260929010000_itp_review_chain.sql) for why this is a snapshot-per-ITP design,
// same principle as activity_signoff_progress for the H/W/R/S grid. Deliberately separate from the
// existing single-reviewer/approver itp_approval_workflow_configs — that one restricts WHO can click
// the single Approve button; this one replaces that single click with an ordered sequence of
// people, each approving their own step, auto-approving the ITP once the last one does.

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { snapshotInitialIssue } from "@/lib/itps/revisions";
import { createNotification } from "@/lib/notifications/helpers";
import { recordAuditEvent } from "@/lib/audit/log";

// These two tables aren't in the generated Database type yet — same documented escape hatch as
// ACTIVITY_SIGNOFF_PROGRESS_TABLE (lib/signoff/db-types.ts) and ITP_APPROVAL_WORKFLOW_CONFIGS_TABLE.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
const ITP_REVIEW_CHAIN_MEMBERS_TABLE = "itp_review_chain_members" as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
const ITP_REVIEW_PROGRESS_TABLE = "itp_review_progress" as any;

export interface ReviewChainMember {
  id: string;
  reviewerUserId: string;
  reviewerName: string;
  sortOrder: number;
}

export interface ReviewProgressStep {
  id: string;
  reviewerUserId: string;
  reviewerName: string;
  sortOrder: number;
  status: "pending" | "approved";
  reviewedAt: string | null;
}

/** This project's configured review chain, in order — empty when none is set (falls back to today's
 *  single-click Approve, unrestricted or gated only by the org-wide config). */
export async function getProjectReviewChain(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string
): Promise<ReviewChainMember[]> {
  const { data } = await supabase
    .from(ITP_REVIEW_CHAIN_MEMBERS_TABLE)
    .select("id, reviewer_user_id, sort_order, users(full_name)")
    .eq("project_id", projectId)
    .order("sort_order")
    .returns<{ id: string; reviewer_user_id: string; sort_order: number; users: { full_name: string } | null }[]>();

  return (data ?? []).map((row) => ({
    id: row.id,
    reviewerUserId: row.reviewer_user_id,
    reviewerName: row.users?.full_name ?? "Unknown",
    sortOrder: row.sort_order,
  }));
}

/** This specific ITP's review progress snapshot, in order — empty means no chain was configured
 *  for the project when this ITP was submitted (or it's never been submitted). */
export async function getItpReviewProgress(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpId: string
): Promise<ReviewProgressStep[]> {
  const { data } = await supabase
    .from(ITP_REVIEW_PROGRESS_TABLE)
    .select("id, reviewer_user_id, sort_order, status, reviewed_at, users(full_name)")
    .eq("itp_id", itpId)
    .order("sort_order")
    .returns<
      { id: string; reviewer_user_id: string; sort_order: number; status: "pending" | "approved"; reviewed_at: string | null; users: { full_name: string } | null }[]
    >();

  return (data ?? []).map((row) => ({
    id: row.id,
    reviewerUserId: row.reviewer_user_id,
    reviewerName: row.users?.full_name ?? "Unknown",
    sortOrder: row.sort_order,
    status: row.status,
    reviewedAt: row.reviewed_at,
  }));
}

export interface SetReviewChainState {
  error: string | null;
}

/** Admin-only: replaces the project's whole review chain with the ordered list of user ids in
 *  `reviewer_user_ids` (repeated hidden inputs, in the order they should review). An empty list
 *  clears the chain — that project's ITPs go back to the plain single-click Approve. */
export async function setProjectReviewChainAction(_prev: SetReviewChainState, formData: FormData): Promise<SetReviewChainState> {
  "use server";
  const projectId = String(formData.get("project_id") ?? "").trim();
  const reviewerIds = formData.getAll("reviewer_user_ids").map(String).filter(Boolean);

  if (!projectId) return { error: "Missing project." };

  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can configure a project's review chain." };
  }

  const supabase = await createSupabaseServerClient();

  const { error: deleteError } = await supabase.from(ITP_REVIEW_CHAIN_MEMBERS_TABLE).delete().eq("project_id", projectId);
  if (deleteError) return { error: "Could not update the review chain. Check you have permission and try again." };

  if (reviewerIds.length > 0) {
    const { error: insertError } = await supabase.from(ITP_REVIEW_CHAIN_MEMBERS_TABLE).insert(
      reviewerIds.map((reviewerUserId, i) => ({
        project_id: projectId,
        reviewer_user_id: reviewerUserId,
        sort_order: i,
      }))
    );
    if (insertError) return { error: "Could not save the review chain. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

/**
 * Called from advanceItpStatusAction the moment an ITP moves draft -> under_review. Snapshots the
 * project's CURRENT chain onto this ITP — a later edit to the project's chain never retroactively
 * changes an ITP already mid-review. No-op (returns false) when the project has no chain configured,
 * so the caller can fall back to today's plain single-click Approve behaviour unchanged.
 */
export async function startReviewChainForItp(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpId: string,
  projectId: string
): Promise<boolean> {
  const chain = await getProjectReviewChain(supabase, projectId);
  if (chain.length === 0) return false;

  await supabase.from(ITP_REVIEW_PROGRESS_TABLE).insert(
    chain.map((member) => ({
      itp_id: itpId,
      reviewer_user_id: member.reviewerUserId,
      sort_order: member.sortOrder,
      status: "pending" as const,
    }))
  );

  // Best-effort: only the FIRST reviewer needs to act right now — later ones are notified as their
  // turn comes up in approveReviewStepAction below, not all at once (that's the whole point of a
  // strict hierarchy rather than "everyone review whenever").
  try {
    const first = chain[0];
    const { data: itp } = await supabase
      .from("itps")
      .select("itp_number, title, projects(organization_id)")
      .eq("id", itpId)
      .maybeSingle<{ itp_number: string; title: string; projects: { organization_id: string } | null }>();
    if (itp?.projects?.organization_id) {
      await createNotification(supabase, {
        organizationId: itp.projects.organization_id,
        projectId,
        recipientUserId: first.reviewerUserId,
        title: "Your review is needed",
        body: `${itp.itp_number} — ${itp.title} (step 1 of ${chain.length})`,
        link: `/inspect/itps/${itpId}`,
      });
    }
  } catch {
    // Best-effort — see doc comment above.
  }

  return true;
}

export interface ApproveReviewStepState {
  error: string | null;
}

/**
 * The current reviewer (whoever holds the lowest-sort_order still-pending row) approves their step.
 * Strict hierarchy: a reviewer further down the chain can't act before their turn — enforced here,
 * not just implied by the UI hiding their button. Auto-approves the whole ITP (same side effects as
 * the manual Approve button: initial-issue snapshot, client notification) the moment the LAST
 * reviewer approves.
 */
export async function approveReviewStepAction(_prev: ApproveReviewStepState, formData: FormData): Promise<ApproveReviewStepState> {
  "use server";
  const itpId = String(formData.get("itp_id") ?? "").trim();
  if (!itpId) return { error: "Missing ITP." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: steps } = await supabase
    .from(ITP_REVIEW_PROGRESS_TABLE)
    .select("id, reviewer_user_id, sort_order, status")
    .eq("itp_id", itpId)
    .order("sort_order")
    .returns<{ id: string; reviewer_user_id: string; sort_order: number; status: "pending" | "approved" }[]>();

  const pendingSteps = (steps ?? []).filter((s) => s.status === "pending");
  const currentStep = pendingSteps[0];

  if (!currentStep) {
    return { error: "There's no pending review step on this ITP." };
  }
  if (!isAdminStaff(session) && currentStep.reviewer_user_id !== session.userId) {
    return { error: "It isn't your turn to review this ITP yet, or you're not on its review chain." };
  }

  const { error: updateError } = await supabase
    .from(ITP_REVIEW_PROGRESS_TABLE)
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", currentStep.id);
  if (updateError) {
    return { error: "Could not record your review. Check you have permission and try again." };
  }

  try {
    const { data: itpForAudit } = await supabase
      .from("itps")
      .select("itp_number, project_id, projects(organization_id)")
      .eq("id", itpId)
      .maybeSingle<{ itp_number: string; project_id: string; projects: { organization_id: string } | null }>();
    if (itpForAudit?.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: itpForAudit.projects.organization_id,
        projectId: itpForAudit.project_id,
        entityType: "itp",
        entityId: itpId,
        action: "review_step_approved",
        actorId: session.userId,
        summary: `Review step ${currentStep.sort_order + 1} approved on ${itpForAudit.itp_number}`,
      });
    }
  } catch {
    // Best-effort.
  }

  const remainingPending = pendingSteps.slice(1);

  if (remainingPending.length === 0) {
    // Last step just approved — auto-approve the ITP itself, same effects as the manual Approve
    // button (advanceItpStatusAction's "approved" branch).
    const now = new Date().toISOString();
    const { error: approveError } = await supabase
      .from("itps")
      .update({ status: "approved", approved_by: session.userId, approved_at: now })
      .eq("id", itpId)
      .eq("status", "under_review");

    if (!approveError) {
      try {
        await snapshotInitialIssue(supabase, itpId, session.userId);

        const { data: itp } = await supabase
          .from("itps")
          .select("itp_number, title, project_id, projects(organization_id)")
          .eq("id", itpId)
          .maybeSingle<{ itp_number: string; title: string; project_id: string; projects: { organization_id: string } | null }>();

        if (itp?.projects?.organization_id) {
          const { data: clientParties } = await supabase
            .from("project_parties")
            .select("user_id")
            .eq("project_id", itp.project_id)
            .eq("party_type", "client")
            .not("user_id", "is", null)
            .returns<{ user_id: string | null }[]>();

          for (const party of clientParties ?? []) {
            if (!party.user_id) continue;
            await createNotification(supabase, {
              organizationId: itp.projects.organization_id,
              projectId: itp.project_id,
              recipientUserId: party.user_id,
              title: "ITP ready for your acceptance",
              body: `${itp.itp_number} — ${itp.title}`,
              link: `/inspect/itps/${itpId}`,
            });
          }
        }
      } catch {
        // Best-effort.
      }
    }
  } else {
    // Notify the NEXT reviewer in line — strict hierarchy means they couldn't act (or even
    // meaningfully see it was their turn) until right now.
    try {
      const next = remainingPending[0];
      const { data: itp } = await supabase
        .from("itps")
        .select("itp_number, title, project_id, projects(organization_id)")
        .eq("id", itpId)
        .maybeSingle<{ itp_number: string; title: string; project_id: string; projects: { organization_id: string } | null }>();
      if (itp?.projects?.organization_id) {
        await createNotification(supabase, {
          organizationId: itp.projects.organization_id,
          projectId: itp.project_id,
          recipientUserId: next.reviewer_user_id,
          title: "Your review is needed",
          body: `${itp.itp_number} — ${itp.title} (step ${next.sort_order + 1} of ${(steps ?? []).length})`,
          link: `/inspect/itps/${itpId}`,
        });
      }
    } catch {
      // Best-effort.
    }
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}
