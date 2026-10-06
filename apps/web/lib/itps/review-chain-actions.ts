"use server";

// The two real Server Actions for the ITP review chain (R79 extension), split out from
// lib/itps/review-chain.ts. Real build failure found live: review-chain.ts is imported by a Client
// Component (review-chain-form.tsx) for its plain types/data-fetch helpers, which pulls the whole
// module into the client bundle — Next.js then rejects the two inline "use server" functions that
// used to live in that same file ("It is not allowed to define inline 'use server' annotated Server
// Actions in Client Components"). A file-level "use server" directive is only valid for a file that
// exports ONLY Server Actions, so those two functions need their own file; the plain data helpers
// and type exports stay in review-chain.ts, safely importable from both Server and Client Components.

import { checklistReviewError } from "@/lib/itps/checklist-review";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { snapshotInitialIssue } from "@/lib/itps/revisions";
import { createNotification } from "@/lib/notifications/helpers";
import { recordAuditEvent } from "@/lib/audit/log";
import {
  getProjectReviewChain,
  ITP_REVIEW_CHAIN_MEMBERS_TABLE,
  ITP_REVIEW_PROGRESS_TABLE,
  ITP_REVIEW_CHAIN_OVERRIDES_TABLE,
} from "@/lib/itps/review-chain";

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

/**
 * Admin-only, per-ITP twin of setProjectReviewChainAction: replaces THIS ITP's own review-chain
 * override with the ordered list of user ids in `reviewer_user_ids`. Only meaningful while the ITP
 * is still 'draft' — startReviewChainForItp snapshots whichever chain applies the moment it's
 * submitted for review, so editing this after submission wouldn't retroactively change anything
 * (the page only renders this form in draft, but the check here is the real enforcement, same
 * "never trust the UI alone" discipline as every other gate in this app). An empty list clears the
 * override, falling back to the project's own chain (or plain single-click Approve if that's empty
 * too).
 */
export async function setItpReviewChainAction(_prev: SetReviewChainState, formData: FormData): Promise<SetReviewChainState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const reviewerIds = formData.getAll("reviewer_user_ids").map(String).filter(Boolean);

  if (!itpId) return { error: "Missing ITP." };

  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can configure an ITP's review chain." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: itp } = await supabase
    .from("itps")
    .select("status, project_id, itp_number, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{ status: string; project_id: string; itp_number: string; projects: { organization_id: string } | null }>();

  if (!itp) return { error: "ITP not found." };
  if (itp.status !== "draft") {
    return { error: "This ITP's review chain can only be set while it's still in draft." };
  }

  const { error: deleteError } = await supabase.from(ITP_REVIEW_CHAIN_OVERRIDES_TABLE).delete().eq("itp_id", itpId);
  if (deleteError) return { error: "Could not update this ITP's review chain. Check you have permission and try again." };

  if (reviewerIds.length > 0) {
    const { error: insertError } = await supabase.from(ITP_REVIEW_CHAIN_OVERRIDES_TABLE).insert(
      reviewerIds.map((reviewerUserId, i) => ({
        itp_id: itpId,
        reviewer_user_id: reviewerUserId,
        sort_order: i,
      }))
    );
    if (insertError) return { error: "Could not save this ITP's review chain. Check you have permission and try again." };
  }

  try {
    if (itp.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: itp.projects.organization_id,
        projectId: itp.project_id,
        entityType: "itp",
        entityId: itpId,
        action: "review_chain_override_configured",
        actorId: session.userId,
        summary: `Review chain override on ${itp.itp_number} set to ${reviewerIds.length} reviewer${reviewerIds.length === 1 ? "" : "s"}`,
        changes: { reviewer_user_ids: reviewerIds },
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

/**
 * The itps.status flip + its side effects (initial-issue snapshot, client notification), pulled out
 * so it can be retried on its own — see the `!currentStep` self-heal branch in
 * approveReviewStepAction below, for the case where every review step is already approved but this
 * write failed the first time it ran. Returns whether the itps update itself succeeded (the
 * snapshot/notification calls stay best-effort either way, same as before).
 */
async function finalizeApprovedReviewChain(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpId: string,
  actorUserId: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const { error: approveError } = await supabase
    .from("itps")
    .update({ status: "approved", approved_by: actorUserId, approved_at: now })
    .eq("id", itpId)
    .eq("status", "under_review");

  if (approveError) return false;

  try {
    await snapshotInitialIssue(supabase, itpId, actorUserId);

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
        .eq("is_active", true)
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
  const itpId = String(formData.get("itp_id") ?? "").trim();
  if (!itpId) return { error: "Missing ITP." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const gate = await checklistReviewError(supabase, itpId, formData);
  if (gate) return { error: gate };

  const { data: steps } = await supabase
    .from(ITP_REVIEW_PROGRESS_TABLE)
    .select("id, reviewer_user_id, sort_order, status")
    .eq("itp_id", itpId)
    .order("sort_order")
    .returns<{ id: string; reviewer_user_id: string; sort_order: number; status: "pending" | "approved" }[]>();

  const pendingSteps = (steps ?? []).filter((s) => s.status === "pending");
  const currentStep = pendingSteps[0];

  if (!currentStep) {
    // Real gap found in a transactional-integrity audit: if every review step was already
    // approved but the ITP itself never flipped to 'approved' (the finalization write below
    // failed after the last step was recorded), this used to be a dead end — "no pending step"
    // with no way to retry the stuck finalization, since there's genuinely no step left to
    // re-approve. Self-heal: if that's exactly the state, retry finalizing right here instead of
    // just erroring.
    const allApproved = (steps ?? []).length > 0 && (steps ?? []).every((s) => s.status === "approved");
    if (allApproved) {
      const { data: itpStatus } = await supabase.from("itps").select("status").eq("id", itpId).maybeSingle<{ status: string }>();
      if (itpStatus?.status === "under_review") {
        const finalized = await finalizeApprovedReviewChain(supabase, itpId, session.userId);
        if (!finalized) return { error: "Every review step is approved, but finalizing the ITP failed again. Try once more." };
        revalidatePath(`/inspect/itps/${itpId}`);
        return { error: null };
      }
    }
    return { error: "There's no pending review step on this ITP." };
  }
  if (!isAdminStaff(session) && currentStep.reviewer_user_id !== session.userId) {
    return { error: "It isn't your turn to review this ITP yet, or you're not on its review chain." };
  }

  // Real gap found in audit: the chain is snapshotted at submission time (startReviewChainForItp)
  // and never re-checked against the reviewer's CURRENT access — if this person was removed from
  // the org after the chain was set, the step deadlocks forever with no way to unstick it (unlike
  // the H/W/R/S grid, which has reassignSignoffPartyAction). Not a security hole in itself (a
  // removed user can't get a session), but a real deadlock risk — surface it clearly so an Admin
  // knows to use reassignReviewStepAction below instead of assuming the step is just "not ready".
  if (!isAdminStaff(session)) {
    const { data: stillGranted } = await supabase
      .from("access_grants")
      .select("id")
      .eq("user_id", session.userId)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (!stillGranted) {
      return { error: "Your access to this organisation appears to have been removed — ask a JAGS Admin to reassign this review step." };
    }
  }

  // Segregation of duties: whoever prepared or submitted the ITP can't be the reviewer who signs it
  // (a JAGS Admin may, but it is recorded in the audit trail).
  let selfReview = false;
  {
    const { data: authorship } = await supabase
      .from("itps")
      .select("prepared_by, reviewed_by")
      .eq("id", itpId)
      .maybeSingle<{ prepared_by: string | null; reviewed_by: string | null }>();
    if (authorship && (authorship.prepared_by === session.userId || authorship.reviewed_by === session.userId)) {
      if (!isAdminStaff(session)) {
        return { error: "You prepared or submitted this ITP, so someone else has to review it (segregation of duties)." };
      }
      selfReview = true;
    }
  }

  const { data: recordedRows, error: updateError } = await supabase
    .from(ITP_REVIEW_PROGRESS_TABLE)
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", currentStep.id)
    .eq("status", "pending")
    .select("id");
  if (updateError) {
    return { error: "Could not record your review. Check you have permission and try again." };
  }
  if (!recordedRows?.length) {
    revalidatePath(`/inspect/itps/${itpId}`);
    return { error: "This review step was already recorded — refresh the page." };
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
        action: selfReview ? "review_step_self_approved" : "review_step_approved",
        actorId: session.userId,
        summary: `Review step ${currentStep.sort_order + 1} approved on ${itpForAudit.itp_number}${selfReview ? " (by the person who prepared/submitted it)" : ""}`,
      });
    }
  } catch {
    // Best-effort.
  }

  const remainingPending = pendingSteps.slice(1);

  if (remainingPending.length === 0) {
    // Last step just approved — auto-approve the ITP itself, same effects as the manual Approve
    // button (advanceItpStatusAction's "approved" branch). A failure here is now surfaced (not
    // silently swallowed) and self-healable via the `!currentStep` branch above on a later click.
    const finalized = await finalizeApprovedReviewChain(supabase, itpId, session.userId);
    if (!finalized) {
      return { error: "Your review was recorded, but finalizing the ITP failed — try clicking Approve again to retry." };
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

export interface ReassignReviewStepState {
  error: string | null;
}

/**
 * Admin-only escape hatch for the deadlock the audit flagged: a review chain is snapshotted at
 * submission time and has no reassignment path if that reviewer is later removed from the org or
 * deactivated — the ITP would otherwise sit stuck at "under_review" forever with no route forward.
 * Only repoints a still-PENDING step (an already-approved step is a historical record, not editable).
 */
export async function reassignReviewStepAction(_prev: ReassignReviewStepState, formData: FormData): Promise<ReassignReviewStepState> {
  const stepId = String(formData.get("step_id") ?? "").trim();
  const newReviewerUserId = String(formData.get("new_reviewer_user_id") ?? "").trim();
  const itpId = String(formData.get("itp_id") ?? "").trim();
  if (!stepId || !newReviewerUserId || !itpId) return { error: "Missing step or replacement reviewer." };

  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can reassign a stuck review step." };
  }

  const supabase = await createSupabaseServerClient();
  const { error, data } = await supabase
    .from(ITP_REVIEW_PROGRESS_TABLE)
    .update({ reviewer_user_id: newReviewerUserId })
    .eq("id", stepId)
    .eq("itp_id", itpId)
    .eq("status", "pending")
    .select("id")
    .returns<{ id: string }[]>();

  if (error) return { error: "Could not reassign this review step." };
  if (!data || data.length === 0) return { error: "This step is no longer pending — it may already have been reviewed." };

  try {
    const { data: itp } = await supabase
      .from("itps")
      .select("itp_number, title, project_id, projects(organization_id)")
      .eq("id", itpId)
      .maybeSingle<{ itp_number: string; title: string; project_id: string; projects: { organization_id: string } | null }>();
    if (itp?.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: itp.projects.organization_id,
        projectId: itp.project_id,
        entityType: "itp",
        entityId: itpId,
        action: "review_step_reassigned",
        actorId: session.userId,
        summary: `Review step reassigned on ${itp.itp_number}`,
      });
      await createNotification(supabase, {
        organizationId: itp.projects.organization_id,
        projectId: itp.project_id,
        recipientUserId: newReviewerUserId,
        title: "Your review is needed",
        body: `${itp.itp_number} — ${itp.title}`,
        link: `/inspect/itps/${itpId}`,
      });
    }
  } catch {
    // Best-effort.
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  revalidatePath(`/inspect/itps/${itpId}/approval-roadmap`);
  return { error: null };
}
