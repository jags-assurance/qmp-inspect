import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { PageGuide } from "@/components/domain/page-guide";
import {
  getItpReviewProgress,
  getItpReviewChainOverride,
  getProjectReviewChain,
} from "@/lib/itps/review-chain";
import { INTERVENTION_LEVEL_TYPES_TABLE, FALLBACK_NOTICE_PERIOD_HOURS, sortLevels } from "@/lib/intervention-levels/types";
import {
  ACTIVITY_SIGNOFF_PROGRESS_TABLE,
  NOTICE_PERIOD_CONFIGS_TABLE,
  type ActivitySignoffProgressRow,
} from "@/lib/signoff/db-types";
import { HwrsSection, type HwrsPoint } from "./hwrs-section";
import { ItpReviewChainForm } from "../itp-review-chain-form";
import { ItpAcceptorPicker } from "../itp-acceptor-picker";
import { ItpApprovalRoadmap } from "../itp-approval-roadmap";

/**
 * Own page (not an inline panel on the ITP page — found too heavy there for what's mostly a
 * "check on this occasionally" view) for the document's own approval lifecycle: same "roadmap"
 * pattern as the sibling Completion Roadmap (/inspect/itps/[id]/status, which tracks field-execution
 * evidence instead). Two sections, in the order actually asked for: the PLAN first (who's assigned
 * to approve/accept, editable by an Admin, so it's set BEFORE anyone starts acting on it) then the
 * live PROCESS below it (each stage showing its person's name whether that stage has happened yet or
 * not, so whoever's turn is next knows it, and everyone else can watch the whole thing progress).
 */
export async function ApprovalRoadmapView({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: itp } = await supabase
    .from("itps")
    .select(
      "id, itp_number, title, status, project_id, approved_by, approved_at, client_accepted_by, client_accepted_at, assigned_acceptor_user_id, projects(name, organization_id)"
    )
    .eq("id", id)
    .maybeSingle<{
      id: string;
      itp_number: string;
      title: string;
      status: "draft" | "under_review" | "approved" | "client_accepted";
      project_id: string;
      approved_by: string | null;
      approved_at: string | null;
      client_accepted_by: string | null;
      client_accepted_at: string | null;
      assigned_acceptor_user_id: string | null;
      projects: { name: string; organization_id: string } | null;
    }>();

  if (!itp) {
    if (embedded) {
      return (
        <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
          ITP not found. It may have been removed or you may not have access.
        </div>
      );
    }
    notFound();
  }

  const [
    { data: sections },
    { data: parties },
    { data: levelTypes },
    { data: noticeConfigs },
    itpReviewChainOverride,
    projectReviewChain,
    reviewSteps,
    { data: staffUsers },
  ] = await Promise.all([
    supabase
      .from("itp_sections")
      .select("id, itp_items(id, item_number, activity)")
      .eq("itp_id", itp.id)
      .returns<{ id: string; itp_items: { id: string; item_number: string; activity: string }[] }[]>(),
    supabase
      .from("project_parties")
      .select("id, party_type, name, user_id, is_active")
      .eq("project_id", itp.project_id)
      .returns<{ id: string; party_type: string; name: string; user_id: string | null; is_active: boolean }[]>(),
    supabase
      .from(INTERVENTION_LEVEL_TYPES_TABLE)
      .select("code, label, sort_order, is_blocking, default_notice_hours")
      .eq("organization_id", itp.projects?.organization_id ?? "")
      .returns<{ code: string; label: string; sort_order: number; is_blocking: boolean; default_notice_hours: number | null }[]>(),
    supabase
      .from(NOTICE_PERIOD_CONFIGS_TABLE)
      .select("intervention, hours")
      .eq("project_id", itp.project_id)
      .returns<{ intervention: string; hours: number }[]>(),
    getItpReviewChainOverride(supabase, itp.id),
    getProjectReviewChain(supabase, itp.project_id),
    itp.status !== "draft" ? getItpReviewProgress(supabase, itp.id) : Promise.resolve([]),
    session.isJagsStaff
      ? supabase.from("users").select("id, full_name").eq("is_jags_staff", true).order("full_name").returns<{ id: string; full_name: string }[]>()
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const itemIds = (sections ?? []).flatMap((s) => (s.itp_items ?? []).map((it) => it.id));
  const itemById = new Map(
    (sections ?? []).flatMap((s) => (s.itp_items ?? []).map((it) => [it.id, { itemNumber: it.item_number, activity: it.activity }] as const))
  );

  const { data: signoffs } = await (
    // activity_signoff_progress already carries the intervention code per row (kept in lockstep with
  // activity_party_intervention by a DB trigger — one row per (item, party) pair that has a level
  // set) — no need for a separate query against activity_party_intervention just to know who holds
  // what; this one table has everything the per-person detail below needs.
  itemIds.length > 0
    ? supabase
        .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
        .select("id, itp_item_id, project_party_id, intervention, status, notified_at, signed_off_at, signed_off_by, proceeded_reason")
        .in("itp_item_id", itemIds)
        .returns<Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "project_party_id" | "intervention" | "status" | "notified_at" | "signed_off_at" | "signed_off_by" | "proceeded_reason">[]>()
    : Promise.resolve({
        data: [] as Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "project_party_id" | "intervention" | "status" | "notified_at" | "signed_off_at" | "signed_off_by" | "proceeded_reason">[],
      })
  );

  const { data: approvalNamesRows } = await (
    supabase
      .from("users")
      .select("id, full_name")
      .in("id", [itp.approved_by, itp.client_accepted_by, itp.assigned_acceptor_user_id, ...(signoffs ?? []).map((r) => r.signed_off_by)].filter((v): v is string => Boolean(v)))
      .returns<{ id: string; full_name: string }[]>()
  );

  const nameById = new Map((approvalNamesRows ?? []).map((u) => [u.id, u.full_name]));

  // Columns added after the generated types: returned-to-draft, revision awaiting approval, external approval.
  const { data: lifecycleExtra } = await supabase
    .from("itps" as never)
    .select("revision, returned_reason, returned_at, revision_needs_approval, external_approval_reference, external_approval_recorded_at")
    .eq("id" as never, id as never)
    .maybeSingle<{
      revision: number;
      returned_reason: string | null;
      returned_at: string | null;
      revision_needs_approval: boolean;
      external_approval_reference: string | null;
      external_approval_recorded_at: string | null;
    }>();
  const formatWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB") : null);

  const signoffTotal = (signoffs ?? []).length;
  const signoffComplete = (signoffs ?? []).filter((s) => s.status === "signed_off").length;

  const levels = sortLevels(levelTypes ?? []).map((l) => ({
    code: l.code,
    label: l.label,
    isBlocking: l.is_blocking,
    // Same precedence as overdue_hold_points(): project override > level default > H/W fallback > 48h.
    noticeHours:
      (noticeConfigs ?? []).find((n) => n.intervention === l.code)?.hours ??
      l.default_notice_hours ??
      FALLBACK_NOTICE_PERIOD_HOURS[l.code] ??
      48,
  }));
  const hwrsPoints: HwrsPoint[] = (signoffs ?? []).flatMap((row) => {
    const item = itemById.get(row.itp_item_id);
    if (!item) return [];
    return [
      {
        id: row.id,
        itemId: row.itp_item_id,
        itemNumber: item.itemNumber,
        activity: item.activity,
        partyId: row.project_party_id,
        levelCode: row.intervention,
        status: row.status,
        notifiedAt: row.notified_at,
        signedOffAt: row.signed_off_at,
        signedOffByName: row.signed_off_by ? (nameById.get(row.signed_off_by) ?? null) : null,
        proceededReason: row.proceeded_reason,
      },
    ];
  });
  const hwrsParties = (parties ?? []).map((p) => ({ id: p.id, name: p.name, partyType: p.party_type, isActive: p.is_active }));

  const clientPartyUsers = (parties ?? [])
    .filter((p) => p.party_type === "client" && p.is_active && p.user_id)
    .map((p) => ({ userId: p.user_id as string, name: p.name }));

  // The PLAN: this ITP's own override if it has one, else the project's default chain — the same
  // precedence startReviewChainForItp itself uses when the ITP is actually submitted. Shown before
  // submission (draft) so it's clear who WILL review once it's sent, not just who already has.
  const plannedChain = itpReviewChainOverride.length > 0 ? itpReviewChainOverride : projectReviewChain;
  const usingProjectDefault = itpReviewChainOverride.length === 0;

  const Heading = embedded ? "h2" : "h1";
  return (
    <div>
      {!embedded && (
        <Link href={`/inspect/itps/${itp.id}`} className="text-sm text-burgundy hover:underline">
        ← Back to ITP
      </Link>
      )}
      <div className={embedded ? "" : "mt-2"}>
        <p className="text-sm text-muted">{itp.projects?.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Heading className="text-2xl font-semibold text-ink">
            Approval roadmap <span className="doc-id text-lg text-muted">{itp.itp_number}</span>
          </Heading>
          <PageGuide
            title="Approval roadmap — how this works"
            points={[
              "The Plan (top): who is assigned to approve and accept this ITP, set before anyone acts — a JAGS Admin can assign a specific ordered review chain and a specific client acceptor here, or leave either unset to keep the open default (any JAGS staff approves, any linked client party accepts).",
              "The Process (below): the live stage-by-stage status — Draft, Submitted, Review chain, Approved, Client accepted — each stage shows who's responsible for it, so the next person in line knows it's their turn and everyone else can watch it progress.",
              "This is the document's own approval lifecycle, not field-execution progress — see the separate Completion roadmap for checklist/evidence/measurement completion.",
            ]}
          />
        </div>
        <p className="mt-1 break-words text-sm text-muted">{itp.title}</p>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">1. The plan — who approves, who accepts</h2>
        <p className="mt-1 text-xs text-muted">Set once, before the process starts — this is what everyone below is following.</p>

        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-muted">Review chain (in order)</p>
            {plannedChain.length > 0 ? (
              <ol className="mt-1 space-y-0.5">
                {plannedChain.map((member, i) => (
                  <li key={member.id} className="break-words text-sm text-ink">
                    {i + 1}. {member.reviewerName}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-sm text-ink">Any JAGS staff member — no chain configured</p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-muted">Accepts</p>
            <p className="mt-1 text-sm text-ink">
              {itp.assigned_acceptor_user_id
                ? (nameById.get(itp.assigned_acceptor_user_id) ?? "Assigned person")
                : "Any linked client party"}
            </p>
          </div>
        </div>

        {session.isJagsStaff && itp.status !== "client_accepted" && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            {itp.status === "draft" && (
              <ItpReviewChainForm
                itpId={itp.id}
                staff={staffUsers ?? []}
                initialChain={itpReviewChainOverride}
                usingProjectDefault={usingProjectDefault}
              />
            )}
            <ItpAcceptorPicker itpId={itp.id} clientPartyUsers={clientPartyUsers} currentAcceptorUserId={itp.assigned_acceptor_user_id} />
          </div>
        )}
        {!isAdminStaff(session) && (
          <p className="mt-3 text-xs text-muted">Only a JAGS Admin can change who&apos;s assigned here.</p>
        )}
      </div>

      <div className="mt-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">2. The process — where it stands right now</h2>
        {itp.status === "draft" && lifecycleExtra?.returned_reason && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-ink" role="status">
            <p className="font-medium text-danger">Returned for changes</p>
            <p className="mt-0.5 whitespace-pre-line">{lifecycleExtra.returned_reason}</p>
            {lifecycleExtra.returned_at && <p className="mt-1 text-xs text-muted">{formatWhen(lifecycleExtra.returned_at)}</p>}
          </div>
        )}
        {lifecycleExtra?.revision_needs_approval && (itp.status === "approved" || itp.status === "client_accepted") && (
          <div className="mb-3 rounded-md border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-ink" role="status">
            <p className="font-medium">Revision {lifecycleExtra.revision} is awaiting approval</p>
            <p className="mt-0.5 text-xs text-muted">The stages below show the originally issued ITP; the latest change still needs re-approval.</p>
          </div>
        )}
        {reviewSteps.length > 0 && (
          <div className="mb-3 rounded-md border border-border bg-surface px-4 py-3">
            <p className="text-xs font-medium text-muted">Review chain</p>
            <ol className="mt-1 space-y-1">
              {reviewSteps.map((step) => (
                <li key={step.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-ink">
                  <span>
                    {step.sortOrder + 1}. {step.reviewerName}
                  </span>
                  <span className={step.status === "approved" ? "text-xs font-medium text-success" : "text-xs text-muted"}>
                    {step.status === "approved" ? `Approved${step.reviewedAt ? ` · ${formatWhen(step.reviewedAt)}` : ""}` : "Pending"}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {lifecycleExtra?.external_approval_reference && (
          <p className="mb-3 text-xs text-muted">
            External approval recorded: <span className="text-ink">{lifecycleExtra.external_approval_reference}</span>
            {lifecycleExtra.external_approval_recorded_at ? ` · ${formatWhen(lifecycleExtra.external_approval_recorded_at)}` : ""}
          </p>
        )}
        <ItpApprovalRoadmap
          status={itp.status}
          reviewSteps={reviewSteps}
          approvedByName={itp.approved_by ? nameById.get(itp.approved_by) ?? null : null}
          approvedAt={itp.approved_at}
          assignedAcceptorName={itp.assigned_acceptor_user_id ? nameById.get(itp.assigned_acceptor_user_id) ?? null : null}
          clientAcceptedByName={itp.client_accepted_by ? nameById.get(itp.client_accepted_by) ?? null : null}
          clientAcceptedAt={itp.client_accepted_at}
          signoffTotal={signoffTotal}
          signoffComplete={signoffComplete}
        />
      </div>

      <HwrsSection levels={levels} parties={hwrsParties} points={hwrsPoints} nowMs={Date.now()} />
    </div>
  );
}
