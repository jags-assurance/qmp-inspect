"use server";

// The two real Server Actions for the ITP review chain (R79 extension), split out from
// lib/itps/review-chain.ts. Real build failure found live: review-chain.ts is imported by a Client
// Component (review-chain-form.tsx) for its plain types/data-fetch helpers, which pulls the whole
// module into the client bundle — Next.js then rejects the two inline "use server" functions that
// used to live in that same file ("It is not allowed to define inline 'use server' annotated Server
// Actions in Client Components"). A file-level "use server" directive is only valid for a file that
// exports ONLY Server Actions, so those two functions need their own file; the plain data helpers
// and type exports stay in review-chain.ts, safely importable from both Server and Client Components.

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { snapshotInitialIssue } from "@/lib/itps/revisions";
import { createNotification } from "@/lib/notifications/helpers";
import { recordAuditEvent } from "@/lib/audit/log";
import { getProjectReviewChain, ITP_REVIEW_CHAIN_MEMBERS_TABLE, ITP_REVIEW_PROGRESS_TABLE } from "@/lib/itps/review-chain";

export interface SetReviewChainState {
  error: string | null;
}

/** Admin-only: replaces the project's whole review chain with the ordered list of user ids in
 *  `reviewer_user_ids` (repeated hidden inputs, in the order they should review). An empty list
 *  clears the chain — that project's ITPs go back to the plain single-click Approve. */
export async function setProjectReviewChainAction(_prev: SetReviewChainState, formData: FormData): Promise<SetReviewChainState> {
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

  try {
    const { data: project } = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle<{ organization_id: string }>();
    if (project?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "itp_review_chain",
        entityId: projectId,
        action: "configured",
        actorId: session.userId,
        summary: `Review chain set to ${reviewerIds.length} reviewer${reviewerIds.length === 1 ? "" : "s"}`,
        changes: { reviewer_user_ids: reviewerIds },
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
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
