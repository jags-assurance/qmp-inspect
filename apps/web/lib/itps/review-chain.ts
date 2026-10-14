// R79 extension: project-wide, ordered, multi-person ITP review chain — see the migration's own
// header comment (20260929010000_itp_review_chain.sql) for why this is a snapshot-per-ITP design,
// same principle as activity_signoff_progress for the H/W/R/S grid. Deliberately separate from the
// existing single-reviewer/approver itp_approval_workflow_configs — that one restricts WHO can click
// the single Approve button; this one replaces that single click with an ordered sequence of
// people, each approving their own step, auto-approving the ITP once the last one does.
//
// Only plain data helpers + types live here — the two real Server Actions (setProjectReviewChainAction,
// approveReviewStepAction) live in the sibling review-chain-actions.ts. This file is imported by a
// Client Component (review-chain-form.tsx) for its types/getProjectReviewChain, which pulls it into
// the client bundle; a file containing an inline "use server" function can't be imported that way
// (Next.js build error found live — see review-chain-actions.ts's own doc comment).

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createNotification } from "@/lib/notifications/helpers";
import { nextReviewRound } from "@/lib/itps/lifecycle";

// These two tables aren't in the generated Database type yet — same documented escape hatch as
// ACTIVITY_SIGNOFF_PROGRESS_TABLE (lib/signoff/db-types.ts) and ITP_APPROVAL_WORKFLOW_CONFIGS_TABLE.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const ITP_REVIEW_CHAIN_MEMBERS_TABLE = "itp_review_chain_members" as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const ITP_REVIEW_PROGRESS_TABLE = "itp_review_progress" as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const ITP_REVIEW_CHAIN_OVERRIDES_TABLE = "itp_review_chain_overrides" as any;

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

/**
 * This ONE ITP's own review chain override, in order — separate from (and taking precedence over)
 * the project-wide chain below. Lets an Admin give a specific ITP its own reviewers instead of
 * every ITP on the project being forced to share the same ones.
 */
export async function getItpReviewChainOverride(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpId: string
): Promise<ReviewChainMember[]> {
  const { data } = await supabase
    .from(ITP_REVIEW_CHAIN_OVERRIDES_TABLE)
    .select("id, reviewer_user_id, sort_order, users(full_name)")
    .eq("itp_id", itpId)
    .order("sort_order")
    .returns<{ id: string; reviewer_user_id: string; sort_order: number; users: { full_name: string } | null }[]>();

  return (data ?? []).map((row) => ({
    id: row.id,
    reviewerUserId: row.reviewer_user_id,
    reviewerName: row.users?.full_name ?? "Unknown",
    sortOrder: row.sort_order,
  }));
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

/**
 * S2-13: copies the current review steps into itp_review_progress_history as the next round, so who had
 * approved what survives a return-to-draft or restart. Best-effort and a no-op when there is nothing to keep
 * (or the history table has not been migrated yet): it must never block the caller.
 */
export async function archiveReviewChain(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpId: string,
  reason: string
): Promise<void> {
  try {
    const { data: steps } = await supabase
      .from(ITP_REVIEW_PROGRESS_TABLE)
      .select("reviewer_user_id, sort_order, status, reviewed_at")
      .eq("itp_id", itpId)
      .returns<{ reviewer_user_id: string; sort_order: number; status: string; reviewed_at: string | null }[]>();
    if (!steps?.length) return;
    const { data: maxRow } = await supabase
      .from("itp_review_progress_history" as never)
      .select("review_round")
      .eq("itp_id" as never, itpId as never)
      .order("review_round" as never, { ascending: false })
      .limit(1)
      .maybeSingle<{ review_round: number }>();
    const round = nextReviewRound(maxRow?.review_round ?? null);
    await supabase
      .from("itp_review_progress_history" as never)
      .insert(steps.map((s) => ({ ...s, itp_id: itpId, review_round: round, archived_reason: reason.slice(0, 500) })) as never);
  } catch {
    // Best-effort.
  }
}

export interface ChainReviewerProblem {
  userId: string;
  name: string;
  reason: "not_found" | "deactivated" | "no_access";
}

/** Pure: which chain members can no longer review (missing, deactivated, or without access to the project). */
export function chainReviewerProblems(
  chain: { reviewerUserId: string; reviewerName: string }[],
  users: { id: string; full_name: string; is_active: boolean | null }[],
  reachableUserIds: Set<string>
): ChainReviewerProblem[] {
  const byId = new Map(users.map((u) => [u.id, u]));
  const out: ChainReviewerProblem[] = [];
  for (const m of chain) {
    const u = byId.get(m.reviewerUserId);
    const name = u?.full_name ?? m.reviewerName;
    if (!u) out.push({ userId: m.reviewerUserId, name, reason: "not_found" });
    else if (u.is_active === false) out.push({ userId: m.reviewerUserId, name, reason: "deactivated" });
    else if (!reachableUserIds.has(m.reviewerUserId)) out.push({ userId: m.reviewerUserId, name, reason: "no_access" });
  }
  return out;
}

/** Admin-facing message listing who must be reassigned before the ITP can be submitted. */
export function chainProblemMessage(problems: ChainReviewerProblem[]): string {
  const why = { not_found: "no longer exists", deactivated: "is deactivated", no_access: "no longer has access to this project" } as const;
  const list = problems.map((p) => `${p.name} (${why[p.reason]})`).join("; ");
  return `This ITP's review chain can't start: ${list}. A JAGS Admin must replace ${problems.length === 1 ? "that reviewer" : "those reviewers"} in the review chain, then submit again.`;
}

/** The chain that applies to this ITP: its own override if set, else the project's. */
export async function resolveReviewChain(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpId: string,
  projectId: string
): Promise<ReviewChainMember[]> {
  const itpOverride = await getItpReviewChainOverride(supabase, itpId);
  return itpOverride.length > 0 ? itpOverride : await getProjectReviewChain(supabase, projectId);
}

/** Checks every chain member is an active user who can still reach the project. Returns the problems found. */
export async function checkChainReviewers(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  organizationId: string,
  chain: ReviewChainMember[]
): Promise<ChainReviewerProblem[]> {
  if (chain.length === 0) return [];
  const ids = chain.map((m) => m.reviewerUserId);
  const { data: users } = await supabase
    .from("users")
    .select("id, full_name, is_active")
    .in("id", ids)
    .returns<{ id: string; full_name: string; is_active: boolean | null }[]>();
  const { data: grants } = await supabase
    .from("access_grants")
    .select("user_id")
    .in("user_id", ids)
    .or(`scope_type.eq.global,organization_id.eq.${organizationId},project_id.eq.${projectId}`)
    .returns<{ user_id: string }[]>();
  return chainReviewerProblems(chain, users ?? [], new Set((grants ?? []).map((g) => g.user_id)));
}

export interface StartReviewChainResult {
  /** True when a chain was configured and its steps are now in place. */
  started: boolean;
  /** Set when a chain WAS configured but could not be put in place. The caller must not fall back to single-click approval. */
  error?: string;
}

/**
 * Called from advanceItpStatusAction the moment an ITP moves draft -> under_review. Snapshots the
 * CURRENT chain onto this ITP — this specific ITP's own override if one was configured, else the
 * project's chain — a later edit to either one never retroactively changes an ITP already
 * mid-review. Returns started=false (no error) only when neither is configured. When a chain is
 * configured but the steps cannot be written, returns an error and leaves the previous steps intact
 * (atomic RPC, or restore on failure) so the caller can undo the submission instead of silently
 * degrading to single-click approval.
 */
export async function startReviewChainForItp(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpId: string,
  projectId: string
): Promise<StartReviewChainResult> {
  const chain = await resolveReviewChain(supabase, itpId, projectId);
  if (chain.length === 0) return { started: false };

  // A round that is still there (e.g. an Admin override approved the ITP part-way) is archived first.
  await archiveReviewChain(supabase, itpId, "Review restarted");

  const steps = chain.map((m) => ({ reviewer_user_id: m.reviewerUserId, sort_order: m.sortOrder }));
  const failure = "The review chain could not be set up, so the ITP was not submitted. Try again; if it keeps failing contact an administrator.";

  const { error: rpcError } = await supabase.rpc("replace_itp_review_steps" as never, { p_itp_id: itpId, p_steps: steps } as never);
  if (rpcError) {
    const missingFn = rpcError.code === "42883" || rpcError.code === "PGRST202";
    if (!missingFn) return { started: false, error: failure };
    // Function not migrated yet: delete + insert, restoring the previous steps if anything fails.
    const { data: previous, error: readError } = await supabase
      .from(ITP_REVIEW_PROGRESS_TABLE)
      .select("reviewer_user_id, sort_order, status, reviewed_at")
      .eq("itp_id", itpId)
      .returns<{ reviewer_user_id: string; sort_order: number; status: string; reviewed_at: string | null }[]>();
    if (readError) return { started: false, error: failure };
    const { error: delError } = await supabase.from(ITP_REVIEW_PROGRESS_TABLE).delete().eq("itp_id", itpId);
    if (delError) return { started: false, error: failure };
    const { error: insError } = await supabase.from(ITP_REVIEW_PROGRESS_TABLE).insert(
      steps.map((s) => ({ itp_id: itpId, ...s, status: "pending" as const }))
    );
    if (insError) {
      if (previous?.length) {
        await supabase.from(ITP_REVIEW_PROGRESS_TABLE).delete().eq("itp_id", itpId);
        await supabase.from(ITP_REVIEW_PROGRESS_TABLE).insert(previous.map((p) => ({ ...p, itp_id: itpId })));
      }
      return { started: false, error: failure };
    }
  }

  // Best-effort: only the FIRST reviewer needs to act right now — later ones are notified as their
  // turn comes up in approveReviewStepAction (review-chain-actions.ts), not all at once (that's the
  // whole point of a strict hierarchy rather than "everyone review whenever").
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

  return { started: true };
}
