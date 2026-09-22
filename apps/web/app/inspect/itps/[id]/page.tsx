import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { ActivitySignoffGrid } from "./activity-signoff-grid";
import { InterventionLegend } from "@/components/domain/intervention-legend";
import { acceptItpAction } from "@/lib/itps/actions";
import { AdvanceStatusForm } from "./advance-status-form";
import { ExternalApprovalForm } from "./external-approval-form";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE, type ActivitySignoffProgressRow } from "@/lib/signoff/db-types";
import { notifyAllPendingForItpAction } from "@/lib/signoff/actions";
import type { InterventionLevel } from "@jags/shared-types";
import { AddItemForm } from "./add-item-form";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
// Added for the "propose to master library" action (Reqs R31) — no other change to this file.
import { ITP_MASTER_TEMPLATES_TABLE } from "@/lib/itp-master/types";
import { ProposeToMasterForm } from "./propose-to-master-form";
// Added for R54-R56 "expected -> received" third-party test record tracking — no other change to
// this file beyond the query below and rendering ExpectedRecordsSection per activity.
import {
  ACTIVITY_EXPECTED_RECORDS_TABLE,
  PROVIDER_TO_PARTY_TYPES,
  type ActivityExpectedRecordRow,
  type ExpectedRecordProvider,
} from "@/lib/expected-records/db-types";
import { ExpectedRecordsSection } from "./expected-record-form";
import { getLatestItpPdf } from "@/lib/reports/actions";
import { ItpPdfButton } from "./itp-pdf-button";
import { VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";
import type { VaultDocumentOption } from "./expected-record-form";
import {
  INTERVENTION_LEVEL_TYPES_TABLE,
  FALLBACK_NOTICE_PERIOD_HOURS,
  sortLevels,
  type InterventionLevelTypeRow,
} from "@/lib/intervention-levels/types";
import { AI_USAGE_LOG_TABLE } from "@/lib/ai/log";
import { ITP_REVISIONS_TABLE, type ItpRevisionRow } from "@/lib/itps/revision-types";
import { RevisionHistoryPanel } from "./revision-history-panel";
// R24: sections are fully editable (add/rename/delete/reorder), not fixed to the 4 defaults
// createItpAction seeds — no other change to this file beyond the two components below and the
// isIssued/section-count values passed into them.
import { AddSectionForm } from "./add-section-form";
import { SectionControls } from "./section-controls";
// R41 — AI offline round-trip: download the ITP's current content as an editable .xlsx, then
// re-upload the edited file to create a new validated revision. See offline-revision-form.tsx and
// lib/itps/offline-revision-actions.ts.
import { OfflineRevisionForm } from "./offline-revision-form";
// R23: three-phase ITP lifecycle badge (Development/Execution/Handover) — a real, derived column
// distinct from the status stepper below (see lib/itps/phase.ts's doc comment).
import { ITP_PHASE_LABEL, ITP_PHASE_TONE, normalizeItpPhase } from "@/lib/itps/phase";
// R111: honest "AI not configured" gate (R43's pattern) for the translate-content panel below.
import { isAiConfigured } from "@/lib/ai/gate";
import { TranslateContentPanel } from "./translate-content-panel";

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "gold"> = {
  draft: "neutral",
  under_review: "warning",
  approved: "gold",
  client_accepted: "success",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  under_review: "Under review",
  approved: "Approved",
  client_accepted: "Client accepted",
};

// Simple visual stepper for the ITP's approval lifecycle — purely presentational, mirrors the
// status values above (client_accepted renders as a completed "Approved" step plus its own badge).
const STATUS_STEPS: { key: string; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "under_review", label: "Review" },
  { key: "approved", label: "Approved" },
];

function statusStepIndex(status: string): number {
  if (status === "client_accepted") return 2;
  return STATUS_STEPS.findIndex((s) => s.key === status);
}

const EVIDENCE_LABEL: Record<number, string> = {
  1: "Checklist",
  2: "Document upload",
  3: "Measurement record",
};

export default async function ItpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: itp } = await supabase
    .from("itps")
    .select(
      "*, projects(id, name, organization_id, allow_client_itp_creation, allow_contractor_itp_creation, organizations(name, engagement_scope))"
    )
    .eq("id", id)
    .maybeSingle<{
      id: string;
      itp_number: string;
      title: string;
      scope: string | null;
      applicable_standard: string | null;
      revision: number;
      status: "draft" | "under_review" | "approved" | "client_accepted";
      phase: string;
      external_approval_reference: string | null;
      external_approval_recorded_by: string | null;
      external_approval_recorded_at: string | null;
      projects: {
        id: string;
        name: string;
        organization_id: string;
        allow_client_itp_creation: boolean;
        allow_contractor_itp_creation: boolean;
        organizations: { name: string; engagement_scope: string } | null;
      } | null;
    }>();

  if (!itp) notFound();

  // R80: only fetched once the field is actually set (or the viewer can write it) — a bare name
  // lookup for display, not gated by RLS beyond the normal users_select policy every staff login
  // already has.
  const canRecordExternalApproval =
    session.isJagsStaff && (itp.status === "approved" || itp.status === "client_accepted");
  const { data: externalApprovalRecordedByUser } = itp.external_approval_recorded_by
    ? await supabase
        .from("users")
        .select("full_name")
        .eq("id", itp.external_approval_recorded_by)
        .maybeSingle<{ full_name: string }>()
    : { data: null };

  interface SectionWithItems {
    id: string;
    section_number: number;
    title: string;
    itp_items: {
      id: string;
      item_number: string;
      activity: string;
      acceptance_criteria: string | null;
      evidence_type: 1 | 2 | 3;
      sort_order: number;
      discipline_id: string | null;
      notice_hours_override: number | null;
    }[];
  }

  const canPropose = session.isJagsStaff && (itp.status === "approved" || itp.status === "client_accepted");

  const [
    latestPdf,
    { data: sections },
    { data: parties },
    { data: interventions },
    { data: signoffs },
    { data: noticeConfigs },
    { data: masterTemplates },
    { data: disciplines },
    { data: rawVaultDocuments },
    { data: levelTypes },
    { data: aiDraftReview },
    { data: revisions },
  ] = await Promise.all([
      // getLatestItpPdf opens its own Supabase client and issues its own query — independent of
      // everything else below, so it runs concurrently instead of blocking the rest of the page
      // behind it (previously awaited sequentially before this Promise.all even started).
      getLatestItpPdf(itp.id),
      supabase
        .from("itp_sections")
        .select(
          "id, section_number, title, itp_items(id, item_number, activity, acceptance_criteria, evidence_type, sort_order, discipline_id, notice_hours_override)"
        )
        .eq("itp_id", id)
        .order("section_number")
        .returns<SectionWithItems[]>(),
      supabase
        .from("project_parties")
        .select("id, party_type, name, user_id, is_active")
        .eq("project_id", itp.projects?.id ?? "")
        .order("party_type")
        .returns<{ id: string; party_type: string; name: string; user_id: string | null; is_active: boolean }[]>(),
      supabase
        .from("activity_party_intervention")
        .select("itp_item_id, project_party_id, intervention"),
      // Sign-off state alongside the H/W/R/S grid (R66-R81) — same query-building pattern as the
      // activity_party_intervention query above, just against the sibling progress table.
      supabase
        .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
        .select("id, itp_item_id, project_party_id, intervention, status, notified_at")
        .returns<Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "project_party_id" | "intervention" | "status" | "notified_at">[]>(),
      supabase
        .from("notice_period_configs")
        .select("intervention, hours")
        .eq("project_id", itp.projects?.id ?? "")
        .returns<{ intervention: string; hours: number }[]>(),
      // Only used to populate the "update existing" picker in the propose-to-master form below;
      // querying unconditionally keeps this straightforward, and the table is tiny.
      canPropose
        ? supabase
            .from(ITP_MASTER_TEMPLATES_TABLE)
            .select("id, title")
            .eq("is_active", true)
            .order("title")
            .returns<{ id: string; title: string }[]>()
        : Promise.resolve({ data: [] as { id: string; title: string }[] }),
      supabase
        .from("master_disciplines")
        .select("id, code, name")
        .eq("is_active", true)
        .order("sort_order")
        .returns<{ id: string; code: string; name: string }[]>(),
      // R54-R56 "attach from vault" — lets an expected record (e.g. a calibration cert already on
      // file before the test runs) be satisfied by picking an existing vault document instead of
      // always re-uploading the same file a second time. Joined to the folder for a readable label.
      supabase
        .from(VAULT_DOCUMENTS_TABLE)
        .select("id, title, document_reference, revision, storage_path, vault_folders!inner(project_id, name, folder_key)")
        .eq("vault_folders.project_id", itp.projects?.id ?? "")
        .order("title")
        .returns<
          {
            id: string;
            title: string;
            document_reference: string | null;
            revision: string;
            storage_path: string;
            vault_folders: { name: string; folder_key: string } | null;
          }[]
        >(),
      // This organisation's configured intervention levels (supabase/migrations/
      // 20260917090000_configurable_intervention_levels.sql) — replaces the old hardcoded H/W/R/S
      // set everywhere below, so a custom level an admin adds actually shows up and behaves
      // correctly on this page (picker, chip tone, blocking, notice period).
      supabase
        .from(INTERVENTION_LEVEL_TYPES_TABLE)
        .select("id, organization_id, code, label, sort_order, is_blocking, default_notice_hours, created_at")
        .eq("organization_id", itp.projects?.organization_id ?? "")
        .returns<InterventionLevelTypeRow[]>(),
      // R42 — was this ITP created from an AI draft? logAiUsage/recordAiReviewDecision (lib/ai/log.ts)
      // stamp target_type="itp"/target_id=<this itp> once createItpFromDraftAction confirms the draft,
      // so a matching row is exactly "this ITP came from an AI draft, reviewed by X on Y" — no new
      // column needed on itps itself.
      supabase
        .from(AI_USAGE_LOG_TABLE)
        .select("reviewed_by, reviewed_at, users!reviewed_by(full_name)")
        .eq("feature", "itp_draft")
        .eq("target_type", "itp")
        .eq("target_id", itp.id)
        .maybeSingle<{ reviewed_by: string | null; reviewed_at: string | null; users: { full_name: string } | null }>(),
      // R101 revision history — frozen snapshots of past revisions, newest first. See
      // lib/itps/revisions.ts for what writes these rows.
      supabase
        .from(ITP_REVISIONS_TABLE)
        .select("id, itp_id, revision, title, scope, applicable_standard, sections_snapshot, reason, created_by, created_at, users(full_name)")
        .eq("itp_id", itp.id)
        .order("revision", { ascending: false })
        .returns<(ItpRevisionRow & { users: { full_name: string } | null })[]>(),
    ]);

  // R54-R56 expected records: fetched separately from the Promise.all above since it needs the
  // item ids that come out of the `sections` query first.
  const allItemIds = (sections ?? []).flatMap((s) => (s.itp_items ?? []).map((it) => it.id));
  const { data: expectedRecords } = allItemIds.length
    ? await supabase
        .from(ACTIVITY_EXPECTED_RECORDS_TABLE)
        .select("id, itp_item_id, provider, record_type, document_number, storage_path, received_at, created_at")
        .in("itp_item_id", allItemIds)
        .order("created_at")
        .returns<ActivityExpectedRecordRow[]>()
    : { data: [] as ActivityExpectedRecordRow[] };

  const expectedRecordsByItem = new Map<string, ActivityExpectedRecordRow[]>();
  for (const record of expectedRecords ?? []) {
    const list = expectedRecordsByItem.get(record.itp_item_id) ?? [];
    list.push(record);
    expectedRecordsByItem.set(record.itp_item_id, list);
  }

  const vaultDocuments: VaultDocumentOption[] = (rawVaultDocuments ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    documentReference: d.document_reference,
    storagePath: d.storage_path,
    folderName: d.vault_folders?.name ?? "Document Vault",
  }));

  // R103/R125: governing-drawing picker on AddItemForm only offers documents actually filed under
  // the "Drawings" vault folder, not the whole vault.
  const drawingDocuments = (rawVaultDocuments ?? [])
    .filter((d) => d.vault_folders?.folder_key === "drawings")
    .map((d) => ({ id: d.id, title: d.title, revision: d.revision }));

  // A party can mark their own provider's record received if their login is linked to a
  // project_parties row of that party_type (mirrors canSignOffForParty) — staff always can. Computed
  // as a plain object (not a function) since a Server Component can never pass a function to a
  // Client Component as a prop — only Server Actions cross that boundary.
  const ownPartyTypes = new Set((parties ?? []).filter((p) => p.user_id === session.userId).map((p) => p.party_type));
  const canMarkReceivedByProvider: Record<ExpectedRecordProvider, boolean> = {
    jags: session.isJagsStaff || PROVIDER_TO_PARTY_TYPES.jags.some((pt) => ownPartyTypes.has(pt)),
    tpi: session.isJagsStaff || PROVIDER_TO_PARTY_TYPES.tpi.some((pt) => ownPartyTypes.has(pt)),
    contractor: session.isJagsStaff || PROVIDER_TO_PARTY_TYPES.contractor.some((pt) => ownPartyTypes.has(pt)),
  };

  const disciplineByid = new Map((disciplines ?? []).map((d) => [d.id, d.code]));

  const interventionMap = new Map<string, InterventionLevel>();
  for (const row of interventions ?? []) {
    interventionMap.set(`${row.itp_item_id}:${row.project_party_id}`, row.intervention as InterventionLevel);
  }

  const signoffMap = new Map<string, NonNullable<typeof signoffs>[number]>();
  for (const row of signoffs ?? []) {
    signoffMap.set(`${row.itp_item_id}:${row.project_party_id}`, row);
  }

  // Sign-off progress summary (near the page top) and "Notify all pending" gating below — both
  // computed from the same activity_signoff_progress rows already fetched above, no extra query.
  const signoffTotal = (signoffs ?? []).length;
  const signoffComplete = (signoffs ?? []).filter((row) => row.status === "signed_off").length;
  const hasPendingSignoffs = (signoffs ?? []).some((row) => row.status === "pending");

  const levels = sortLevels(levelTypes ?? []);
  const blockingCodes = new Set(levels.filter((l) => l.is_blocking).map((l) => l.code));

  // Precedence, highest first: a project-level notice_period_configs override, then this
  // organisation's own configured default_notice_hours for that level, then the original hardcoded
  // spec fallback (Hold=48h/Witness=24h) for the two levels that ever had one — same three-tier
  // fallback behaviour the app always had, just no longer restricted to literal "H"/"W" codes.
  const noticeHours: Record<string, number> = {};
  for (const level of levels) {
    if (level.default_notice_hours != null) noticeHours[level.code] = level.default_notice_hours;
    else if (FALLBACK_NOTICE_PERIOD_HOURS[level.code] != null) noticeHours[level.code] = FALLBACK_NOTICE_PERIOD_HOURS[level.code];
  }
  for (const config of noticeConfigs ?? []) {
    noticeHours[config.intervention] = config.hours;
  }

  // Client-created ITPs (opt-in per project, or org-wide for a Self-Managed/Platform-Only client —
  // supabase/migrations/20260918000000_client_itp_creation.sql,
  // 20260918010000_self_managed_engagement_scope.sql, and 20260919000000_contractor_itp_creation.sql):
  // the originating client OR subcontractor/main_contractor party can populate sections/items/the
  // intervention grid on their own ITP while it's still 'draft' — mirrors is_client_itp_creator()
  // exactly. Submitting for review, approving, and bulk-notifying stay JAGS-only actions regardless
  // (gated on session.isJagsStaff directly below, not this flag) — approval authority always stays
  // with JAGS even for a Self-Managed client or a contractor-originated ITP.
  const isEligibleItpCreator =
    !session.isJagsStaff &&
    itp.status === "draft" &&
    (parties ?? []).some((p) => {
      if (!p.is_active || p.user_id !== session.userId) return false;
      if (p.party_type === "client") {
        return !!itp.projects?.allow_client_itp_creation || itp.projects?.organizations?.engagement_scope === "self_managed";
      }
      if (p.party_type === "subcontractor" || p.party_type === "main_contractor") {
        return !!itp.projects?.allow_contractor_itp_creation;
      }
      return false;
    });
  const canEditContent = session.isJagsStaff || isEligibleItpCreator;
  // R24/R101: any section add/rename/delete/reorder past this point is an edit-after-issue once
  // the ITP has left draft/under_review — reused by AddSectionForm and SectionControls below,
  // same condition AddItemForm already keys its own "isIssued" prop off of.
  const isIssued = itp.status === "approved" || itp.status === "client_accepted";
  // Submitting for review is a clerical hand-off, not a certification act — unlike Approve (which
  // stays hardcoded to session.isJagsStaff below and never gets this treatment), the same party
  // already trusted to build the whole draft can now also hand it to JAGS themselves. Mirrors
  // itps_client_submit_for_review (20260921000000_self_managed_submit_and_checklist_gen.sql).
  const canSubmitForReview = (session.isJagsStaff || isEligibleItpCreator) && itp.status === "draft";
  // Client acceptance is that specific party's own action — not "any non-staff login," which the
  // end-to-end walkthrough flagged as too broad (a subcontractor/main contractor/TPI login could
  // technically have hit the same button). Mirrors accept_itp()'s own check at the database layer.
  const isLinkedClientParty = (parties ?? []).some((p) => p.party_type === "client" && p.user_id === session.userId);
  const canAccept = isLinkedClientParty && itp.status === "approved";

  // Role-based restriction (R66-R81): a party's sign-off is theirs to give, not anyone's on the
  // project — staff can always countersign, an external user only for the party their own login is
  // linked to via project_parties.user_id, and only while that party is active (see
  // lib/signoff/actions.ts's canSignOffForParty, the server-side twin of this check).
  const canSignOffFor = (partyUserId: string | null, partyIsActive: boolean) =>
    session.isJagsStaff || (partyIsActive && !!partyUserId && partyUserId === session.userId);

  return (
    <div>
      {/* Live cross-party updates: another party's sign-off, or a status/section change, refreshes
          this page automatically instead of requiring a manual reload — the point of the intervention
          grid being multi-party in the first place. Unfiltered on this table (small per-ITP volume;
          Supabase Realtime filters only support simple equality, and this page's relevant rows span
          several itp_item_ids with no single column to filter on cheaply). */}
      <RealtimeRefresh table="activity_signoff_progress" />
      <RealtimeRefresh table="itps" filter={`id=eq.${id}`} />
      <Link href="/inspect/itps" className="text-sm text-burgundy hover:underline">
        ← Back to ITP Register
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="doc-id text-2xl font-semibold text-ink">{itp.itp_number}</h1>
            <Badge tone={STATUS_TONE[itp.status]}>{STATUS_LABEL[itp.status]}</Badge>
            {/* R23: real lifecycle phase, derived from status + sign-off completion — never set
                directly by this page or any action (see lib/itps/phase.ts). */}
            <Badge tone={ITP_PHASE_TONE[normalizeItpPhase(itp.phase)]}>{ITP_PHASE_LABEL[normalizeItpPhase(itp.phase)]}</Badge>
            <span className="text-sm text-muted">Rev {itp.revision}</span>
            {aiDraftReview && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2.5 py-1 text-xs font-medium text-[color:var(--color-burgundy-dark)]"
                title={
                  aiDraftReview.reviewed_at
                    ? `Reviewed by ${aiDraftReview.users?.full_name ?? "a reviewer"} on ${new Date(aiDraftReview.reviewed_at).toLocaleDateString()}`
                    : undefined
                }
              >
                ✨ AI-drafted{aiDraftReview.users?.full_name ? ` · reviewed by ${aiDraftReview.users.full_name}` : ""}
              </span>
            )}
          </div>
          <p className="mt-1 text-lg text-ink">{itp.title}</p>
          <p className="mt-1 text-sm text-muted">
            {itp.projects?.organizations?.name} · {itp.projects?.name}
            {itp.applicable_standard ? ` · ${itp.applicable_standard}` : ""}
          </p>
          {isAiConfigured() && <TranslateContentPanel itpId={itp.id} />}
          {signoffTotal > 0 && (
            <p className="mt-1 text-sm text-muted">
              {signoffComplete} of {signoffTotal} sign-off points complete
            </p>
          )}

          <ol className="mt-3 flex items-center gap-2">
            {STATUS_STEPS.map((step, i) => {
              const current = statusStepIndex(itp.status);
              const done = i <= current;
              return (
                <li key={step.key} className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                      done ? "bg-burgundy/10 text-burgundy" : "bg-muted/10 text-muted"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${done ? "bg-burgundy" : "bg-muted/40"}`}
                      aria-hidden
                    />
                    {step.label}
                  </span>
                  {i < STATUS_STEPS.length - 1 && <span className="h-px w-4 bg-border" aria-hidden />}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="flex flex-wrap gap-2">
          <ItpPdfButton itpId={itp.id} latest={latestPdf} />
          {/* R41: export the ITP's current content as an editable .xlsx — offline-revision-form.tsx
              below is the matching re-upload half of this round trip. Available to anyone who can
              view the ITP, same as the PDF button; the re-upload side is staff-only. */}
          <a
            href={`/api/itps/${itp.id}/export-xlsx`}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
          >
            Download for offline editing
          </a>
          {/* R107: a plain Word copy of the controlled ITP (sections/items + intervention grid),
              stamped "UNCONTROLLED COPY" — see app/api/itps/[id]/export-docx/route.ts. Available to
              anyone who can view the ITP, same as the PDF/.xlsx buttons above. */}
          <a
            href={`/api/itps/${itp.id}/export-docx`}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
          >
            Word
          </a>
          {/* Added by the checklists/inspections slice — links to the new /checklists route added in that feature, no other change to this file. */}
          <Link
            href={`/inspect/itps/${itp.id}/checklists`}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
          >
            Checklists →
          </Link>
          {canSubmitForReview && <AdvanceStatusForm itpId={itp.id} fromStatus="draft" />}
          {session.isJagsStaff && itp.status === "under_review" && (
            <AdvanceStatusForm itpId={itp.id} fromStatus="under_review" />
          )}
          {/* Bulk twin of the per-row Notify button in SignoffCell — notifies every still-pending
              activity_signoff_progress row for this ITP in one click. Stays staff-only even on a
              client-created draft ITP, since notifying sign-off parties is a JAGS orchestration
              action, not part of "build the ITP" content editing (canEditContent). */}
          {session.isJagsStaff && hasPendingSignoffs && (
            <form action={notifyAllPendingForItpAction}>
              <input type="hidden" name="itp_id" value={itp.id} />
              <button type="submit" className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white">
                Notify all pending
              </button>
            </form>
          )}
          {canAccept && (
            <form action={acceptItpAction}>
              <input type="hidden" name="itp_id" value={itp.id} />
              <button type="submit" className="rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark">
                Accept ITP
              </button>
            </form>
          )}
          {/* Added for the "propose to master library" action (Reqs R31) — only shown once the ITP
              has reached approved/client_accepted, matching this file's existing status gating. */}
          {canPropose && (
            <ProposeToMasterForm itpId={itp.id} itpTitle={itp.title} masterTemplates={masterTemplates ?? []} />
          )}
        </div>
      </div>

      {/* R26-29: H/W/R/S (or custom) legend for the per-party grid below — driven by this
          organisation's own intervention_level_types rows (`levels`), never a hardcoded H/W/R/S
          list, so a custom level an admin adds shows up here too. */}
      <InterventionLegend levels={levels} />

      {canRecordExternalApproval && (
        <ExternalApprovalForm
          itpId={itp.id}
          reference={itp.external_approval_reference}
          recordedByName={externalApprovalRecordedByUser?.full_name ?? null}
          recordedAt={itp.external_approval_recorded_at}
        />
      )}

      <RevisionHistoryPanel revisions={revisions ?? []} />

      {/* R41: staff-only re-upload of an offline-edited copy of the export above — creates a new
          validated revision (via bumpRevisionIfIssued, same as every other edit-after-issue path on
          this page) once the reviewer confirms the previewed diff. */}
      {session.isJagsStaff && <OfflineRevisionForm itpId={itp.id} />}

      {/* Jump-to-section nav: purely a scanning aid for long ITPs (several sections, each a wide
          H/W/R/S table) — no data is hidden or removed, this just anchors to each section's
          existing heading. Only worth showing once there's more than one section to jump between. */}
      {(sections ?? []).length > 1 && (
        <nav
          aria-label="Jump to section"
          className="sticky top-0 z-10 mt-8 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-surface/80"
        >
          <span className="text-xs font-medium text-muted">Jump to:</span>
          {(sections ?? []).map((section) => (
            <a
              key={section.id}
              href={`#section-${section.section_number}`}
              className="rounded-full bg-burgundy/10 px-2.5 py-1 text-xs font-medium text-burgundy hover:bg-burgundy/20"
            >
              {section.section_number}. {section.title}
            </a>
          ))}
        </nav>
      )}

      <div className="mt-8 space-y-8">
        {(sections ?? []).map((section, sectionIndex) => (
          <div key={section.id} id={`section-${section.section_number}`} className="rounded-lg border border-border bg-surface scroll-mt-20">
            <div className="border-b border-border px-4 py-3">
              {canEditContent ? (
                <SectionControls
                  itpId={itp.id}
                  sectionId={section.id}
                  sectionNumber={section.section_number}
                  title={section.title}
                  isIssued={isIssued}
                  isFirst={sectionIndex === 0}
                  isLast={sectionIndex === (sections ?? []).length - 1}
                  isOnlySection={(sections ?? []).length <= 1}
                />
              ) : (
                <h2 className="font-medium text-ink">
                  {section.section_number}. {section.title}
                </h2>
              )}
            </div>
            {/* R26-29: per-party H/W/R/S sign-off grid — rows = this section's activities, columns =
                every project_party on the ITP, one real <table> instead of the previous per-activity
                chain-of-chips card layout (see ActivitySignoffGrid). Deliberately wide/scrollable
                (overflow-x-auto lives inside the grid component), matching how real client ITP
                reference documents lay this out. */}
            {(() => {
              const sortedItems = [...(section.itp_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
              const gridRows = sortedItems.map((item) => ({
                itemId: item.id,
                itemNumber: item.item_number,
                activity: item.activity,
                acceptanceCriteria: item.acceptance_criteria,
                evidenceLabel: EVIDENCE_LABEL[item.evidence_type],
                disciplineCode: item.discipline_id ? disciplineByid.get(item.discipline_id) ?? null : null,
                // R25: per-activity override, checked before the level-keyed noticeHours map below.
                noticeHoursOverride: item.notice_hours_override,
                partyCells: (parties ?? []).map((party) => {
                  const intervention = interventionMap.get(`${item.id}:${party.id}`) ?? null;
                  const signoff = signoffMap.get(`${item.id}:${party.id}`) ?? null;
                  return { party, intervention, signoff, canSignOff: canSignOffFor(party.user_id, party.is_active) };
                }),
              }));
              return (
                <>
                  <ActivitySignoffGrid
                    itpId={itp.id}
                    rows={gridRows}
                    parties={(parties ?? []).map((p) => ({ id: p.id, name: p.name }))}
                    canEditContent={canEditContent}
                    isJagsStaff={session.isJagsStaff}
                    noticeHours={noticeHours}
                    levels={levels}
                    blockingCodes={blockingCodes}
                  />
                  {/* R54-R56: expected -> received third-party test record tracking per activity —
                      kept as its own per-activity block below the grid, since it isn't part of the
                      per-party intervention/sign-off grid itself. */}
                  <div>
                    {sortedItems.map((item) => (
                      <div key={item.id} className="border-b border-border px-4 py-3 last:border-0 bg-off-white/40">
                        <p className="mb-1.5 text-xs font-medium text-muted">
                          <span className="doc-id mr-1">{item.item_number}</span>
                          {item.activity}
                        </p>
                        <ExpectedRecordsSection
                          itpItemId={item.id}
                          records={expectedRecordsByItem.get(item.id) ?? []}
                          canAdd={session.isJagsStaff}
                          canMarkReceivedByProvider={canMarkReceivedByProvider}
                          projectId={itp.projects?.id ?? ""}
                          vaultDocuments={vaultDocuments}
                        />
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
            {canEditContent && (
              <AddItemForm
                itpId={itp.id}
                sectionId={section.id}
                disciplines={disciplines ?? []}
                isIssued={isIssued}
                drawingDocuments={drawingDocuments}
              />
            )}
          </div>
        ))}
      </div>

      {canEditContent && <AddSectionForm itpId={itp.id} isIssued={isIssued} />}
    </div>
  );
}
