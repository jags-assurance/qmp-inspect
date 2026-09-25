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
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE, type ActivitySignoffProgressRow } from "@/lib/signoff/db-types";
import type { InterventionLevel } from "@jags/shared-types";
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
export default async function ItpApprovalRoadmapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  if (!itp) notFound();

  const [
    { data: sections },
    { data: parties },
    { data: levelTypes },
    itpReviewChainOverride,
    projectReviewChain,
    reviewSteps,
    { data: staffUsers },
  ] = await Promise.all([
    supabase
      .from("itp_sections")
      .select("id, itp_items(id)")
      .eq("itp_id", itp.id)
      .returns<{ id: string; itp_items: { id: string }[] }[]>(),
    supabase
      .from("project_parties")
      .select("id, party_type, name, user_id, is_active")
      .eq("project_id", itp.project_id)
      .returns<{ id: string; party_type: string; name: string; user_id: string | null; is_active: boolean }[]>(),
    supabase
      .from(INTERVENTION_LEVEL_TYPES_TABLE)
      .select("code, is_blocking")
      .eq("organization_id", itp.projects?.organization_id ?? "")
      .returns<{ code: string; is_blocking: boolean }[]>(),
    getItpReviewChainOverride(supabase, itp.id),
    getProjectReviewChain(supabase, itp.project_id),
    itp.status !== "draft" ? getItpReviewProgress(supabase, itp.id) : Promise.resolve([]),
    session.isJagsStaff
      ? supabase.from("users").select("id, full_name").eq("is_jags_staff", true).order("full_name").returns<{ id: string; full_name: string }[]>()
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const itemIds = (sections ?? []).flatMap((s) => (s.itp_items ?? []).map((it) => it.id));

  const [{ data: interventions }, { data: signoffs }, { data: approvalNamesRows }] = await Promise.all([
    itemIds.length > 0
      ? supabase
          .from("activity_party_intervention")
          .select("itp_item_id, project_party_id, intervention")
          .in("itp_item_id", itemIds)
          .returns<{ itp_item_id: string; project_party_id: string; intervention: InterventionLevel }[]>()
      : Promise.resolve({ data: [] as { itp_item_id: string; project_party_id: string; intervention: InterventionLevel }[] }),
    itemIds.length > 0
      ? supabase
          .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
          .select("id, itp_item_id, status")
          .in("itp_item_id", itemIds)
          .returns<Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "status">[]>()
      : Promise.resolve({ data: [] as Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "status">[] }),
    supabase
      .from("users")
      .select("id, full_name")
      .in("id", [itp.approved_by, itp.client_accepted_by, itp.assigned_acceptor_user_id].filter((v): v is string => Boolean(v)))
      .returns<{ id: string; full_name: string }[]>(),
  ]);

  const nameById = new Map((approvalNamesRows ?? []).map((u) => [u.id, u.full_name]));
  const partyNameById = new Map((parties ?? []).map((p) => [p.id, p.name]));
  const blockingCodes = new Set((levelTypes ?? []).filter((l) => l.is_blocking).map((l) => l.code));

  const signoffTotal = (signoffs ?? []).length;
  const signoffComplete = (signoffs ?? []).filter((s) => s.status === "signed_off").length;

  const holderCountsByParty = new Map<string, Map<string, number>>();
  for (const row of interventions ?? []) {
    const counts = holderCountsByParty.get(row.project_party_id) ?? new Map<string, number>();
    counts.set(row.intervention, (counts.get(row.intervention) ?? 0) + 1);
    holderCountsByParty.set(row.project_party_id, counts);
  }
  const holderSummary = [...holderCountsByParty.entries()]
    .map(([partyId, counts]) => ({
      partyName: partyNameById.get(partyId) ?? "Unknown party",
      levels: [...counts.entries()].map(([code, count]) => ({ code, count, isBlocking: blockingCodes.has(code) })),
    }))
    .sort((a, b) => a.partyName.localeCompare(b.partyName));

  const clientPartyUsers = (parties ?? [])
    .filter((p) => p.party_type === "client" && p.is_active && p.user_id)
    .map((p) => ({ userId: p.user_id as string, name: p.name }));

  // The PLAN: this ITP's own override if it has one, else the project's default chain — the same
  // precedence startReviewChainForItp itself uses when the ITP is actually submitted. Shown before
  // submission (draft) so it's clear who WILL review once it's sent, not just who already has.
  const plannedChain = itpReviewChainOverride.length > 0 ? itpReviewChainOverride : projectReviewChain;
  const usingProjectDefault = itpReviewChainOverride.length === 0;

  return (
    <div>
      <Link href={`/inspect/itps/${itp.id}`} className="text-sm text-burgundy hover:underline">
        ← Back to ITP
      </Link>
      <div className="mt-2">
        <p className="text-sm text-muted">{itp.projects?.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-ink">
            Approval roadmap <span className="doc-id text-lg text-muted">{itp.itp_number}</span>
          </h1>
          <PageGuide
            title="Approval roadmap — how this works"
            points={[
              "The Plan (top): who is assigned to approve and accept this ITP, set before anyone acts — a JAGS Admin can assign a specific ordered review chain and a specific client acceptor here, or leave either unset to keep the open default (any JAGS staff approves, any linked client party accepts).",
              "The Process (below): the live stage-by-stage status — Draft, Submitted, Review chain, Approved, Client accepted — each stage shows who's responsible for it, so the next person in line knows it's their turn and everyone else can watch it progress.",
              "This is the document's own approval lifecycle, not field-execution progress — see the separate Completion roadmap for checklist/evidence/measurement completion.",
            ]}
          />
        </div>
        <p className="mt-1 text-sm text-muted">{itp.title}</p>
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
                  <li key={member.id} className="text-sm text-ink">
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
          holderSummary={holderSummary}
        />
      </div>
    </div>
  );
}
