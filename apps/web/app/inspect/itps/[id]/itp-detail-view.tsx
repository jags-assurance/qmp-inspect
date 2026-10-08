import { notFound } from "next/navigation";
import { normaliseRequiredRegisters } from "@/lib/itps/required-registers";
import Link from "next/link";
import { Suspense } from "react";
import { cn } from "@/lib/cn";
import { ChecklistsView } from "./checklists/checklists-view";
import { StatusView } from "./status/status-view";
import { ApprovalRoadmapView } from "./approval-roadmap/approval-roadmap-view";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { ActivitySignoffGrid } from "./activity-signoff-grid";
import { InterventionLegend } from "@/components/domain/intervention-legend";
import { AcceptItpForm } from "./accept-itp-form";
import { ReviewChainStatus } from "./review-chain-status";
import { getItpReviewProgress } from "@/lib/itps/review-chain";
import { ReturnItpForm } from "./return-itp-form";
import { ApproveRevisionForm } from "./approve-revision-form";
import { BulkAddItemsForm } from "./bulk-add-items-form";
import { AdvanceStatusForm } from "./advance-status-form";
import { ExternalApprovalForm } from "./external-approval-form";
import { ItpChecklistPreview } from "@/components/domain/itp-checklist-preview";
import { loadItpChecklistPreview } from "@/lib/checklists/preview";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE, type ActivitySignoffProgressRow } from "@/lib/signoff/db-types";
import { notifyAllPendingForItpAction } from "@/lib/signoff/actions";
import { ExportLink } from "@/components/domain/export-link";
import type { InterventionLevel } from "@jags/shared-types";
import { AddItemForm } from "./add-item-form";
import { ActivityEvidenceToggle } from "./activity-evidence-toggle";
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
// evidence_type=2/3 field-execution (measurement records, document-upload evidence) — previously
// missing entirely, see status/page.tsx's own "No execution flow yet" comment.
import { type ItpItemMeasurementRow, type ItpItemEvidenceDocumentRow } from "@/lib/itps/evidence-actions";
import { ITP_ITEM_MEASUREMENTS_TABLE, ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE } from "@/lib/itps/evidence-types";
import { ItpItemMeasurementsSection, ItpItemEvidenceDocumentsSection } from "./itp-item-evidence-section";
import { getExecutingPartyTypes } from "@/lib/checklists/execution-parties";
import { getLatestItpPdf } from "@/lib/reports/actions";
import { ItpPdfButton } from "./itp-pdf-button";
import { ItpStalePdfToast } from "./itp-stale-pdf-toast";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
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
import { ReviewHistoryPanel } from "./review-history-panel";
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
import { parseItpTranslations } from "@/lib/itps/translations";
import { describeItpExit } from "@/lib/itps/exit-notice";
import { isAiEnabledForOrg } from "@/lib/ai/gate";
import { hasPermission } from "@/lib/rbac/permissions";
import { TranslateContentPanel } from "./translate-content-panel";
import { ItpExitControls } from "./itp-exit-controls";
import { approvePermissionStrict } from "@/lib/itps/lifecycle";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";
import { PageGuide } from "@/components/domain/page-guide";

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "gold"> = {
  draft: "neutral",
  under_review: "warning",
  approved: "gold",
  client_accepted: "success",
  superseded: "neutral",
  withdrawn: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  under_review: "Under review",
  approved: "Approved",
  client_accepted: "Client accepted",
  superseded: "Superseded",
  withdrawn: "Withdrawn",
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

async function ItpDetailBody({ id, embedded = false }: { id: string; embedded?: boolean }) {
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
      status: "draft" | "under_review" | "approved" | "client_accepted" | "superseded" | "withdrawn";
      phase: string;
      external_approval_reference: string | null;
      external_approval_recorded_by: string | null;
      external_approval_recorded_at: string | null;
      updated_at: string;
      approved_by: string | null;
      approved_at: string | null;
      client_accepted_by: string | null;
      client_accepted_at: string | null;
      assigned_acceptor_user_id: string | null;
      returned_reason: string | null;
      returned_at: string | null;
      withdrawn_reason?: string | null;
      withdrawn_at?: string | null;
      superseded_by_itp_id?: string | null;
      translations?: unknown;
      revision_needs_approval: boolean;
      projects: {
        id: string;
        name: string;
        organization_id: string;
        allow_client_itp_creation: boolean;
        allow_contractor_itp_creation: boolean;
        organizations: { name: string; engagement_scope: string } | null;
      } | null;
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
  const Heading = embedded ? "h2" : "h1";

  // D9: a superseded/withdrawn ITP shows why, when, and a link to the replacement.
  const replacementItp =
    itp.superseded_by_itp_id && (itp.status === "superseded" || itp.status === "withdrawn")
      ? (await supabase.from("itps").select("id, itp_number, title").eq("id", itp.superseded_by_itp_id).maybeSingle<{ id: string; itp_number: string; title: string }>()).data
      : null;

  const exitNotice = describeItpExit({ status: itp.status, reason: itp.withdrawn_reason, at: itp.withdrawn_at });

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
      reference_spec: string | null;
      method: string | null;
      frequency: string | null;
      evidence_type: 1 | 2 | 3;
      sort_order: number;
      discipline_id: string | null;
      notice_hours_override: number | null;
      planned_date: string | null;
    }[];
  }

  const canPropose = session.isJagsStaff && (itp.status === "approved" || itp.status === "client_accepted");

  const [
    latestPdf,
    { data: sections },
    { data: parties },
    { data: noticeConfigs },
    { data: masterTemplates },
    disciplines,
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
          "id, section_number, title, itp_items(id, item_number, activity, acceptance_criteria, reference_spec, method, frequency, evidence_type, sort_order, discipline_id, notice_hours_override, planned_date)"
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
      getActiveMasterDisciplines(),
      // R54-R56 "attach from vault" — lets an expected record (e.g. a calibration cert already on
      // file before the test runs) be satisfied by picking an existing vault document instead of
      // always re-uploading the same file a second time. Joined to the folder for a readable label.
      supabase
        .from(VAULT_DOCUMENTS_TABLE)
        .select("id, title, document_reference, revision, storage_path, status, created_at, vault_folders!inner(project_id, name, folder_key)")
        .eq("vault_folders.project_id", itp.projects?.id ?? "")
        .order("title")
        .returns<
          {
            id: string;
            title: string;
            document_reference: string | null;
            revision: string;
            storage_path: string;
            status: string;
            created_at: string;
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

  // Everything below needs only `allItemIds` (or nothing), so it runs as ONE parallel wave. These used
  // to be six or seven sequential awaits — and the intervention/sign-off queries had no item filter at
  // all, so every page view pulled every ITP's rows in the organisation (each row policy-checked)
  // only to discard them afterwards. Scoping them to this ITP's activities here is what takes the
  // page from ~a minute to a few seconds once an ITP has real sign-off data.
  type EvidenceDocRow = ItpItemEvidenceDocumentRow & {
    vault_documents: { title: string; document_reference: string | null; status: string } | null;
  };
  const noItems = allItemIds.length === 0;
  const [
    { data: interventions },
    { data: signoffs },
    { data: expectedRecords },
    { data: measurements },
    { data: evidenceDocuments },
    executingPartyTypes,
    reviewSteps,
    canApproveItp,
    checklistPreview,
  ] = await Promise.all([
    noItems
      ? Promise.resolve({ data: [] as { itp_item_id: string; project_party_id: string; intervention: string }[] })
      : supabase
          .from("activity_party_intervention")
          .select("itp_item_id, project_party_id, intervention")
          .in("itp_item_id", allItemIds),
    // Sign-off state alongside the H/W/R/S grid (R66-R81).
    noItems
      ? Promise.resolve({
          data: [] as Pick<
            ActivitySignoffProgressRow,
            "id" | "itp_item_id" | "project_party_id" | "intervention" | "status" | "notified_at" | "updated_at"
          >[],
        })
      : supabase
          .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
          .select("id, itp_item_id, project_party_id, intervention, status, notified_at, updated_at")
          .in("itp_item_id", allItemIds)
          .returns<
            Pick<
              ActivitySignoffProgressRow,
              "id" | "itp_item_id" | "project_party_id" | "intervention" | "status" | "notified_at" | "updated_at"
            >[]
          >(),
    noItems
      ? Promise.resolve({ data: [] as ActivityExpectedRecordRow[] })
      : supabase
          .from(ACTIVITY_EXPECTED_RECORDS_TABLE)
          .select("id, itp_item_id, provider, record_type, document_number, storage_path, received_at, created_at")
          .in("itp_item_id", allItemIds)
          .order("created_at")
          .returns<ActivityExpectedRecordRow[]>(),
    // evidence_type=3 ("Measurement record") / evidence_type=2 ("Document upload") field-execution —
    // see lib/itps/evidence-actions.ts.
    noItems
      ? Promise.resolve({ data: [] as ItpItemMeasurementRow[] })
      : supabase
          .from(ITP_ITEM_MEASUREMENTS_TABLE)
          .select("id, itp_item_id, description, nominal_value, tolerance, actual_value, unit, result, sort_order, recorded_by, created_at")
          .in("itp_item_id", allItemIds)
          .order("sort_order")
          .returns<ItpItemMeasurementRow[]>(),
    noItems
      ? Promise.resolve({ data: [] as EvidenceDocRow[] })
      : supabase
          .from(ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE)
          .select("id, itp_item_id, vault_document_id, linked_by, created_at, vault_documents(title, document_reference, status)")
          .in("itp_item_id", allItemIds)
          .order("created_at")
          .returns<EvidenceDocRow[]>(),
    getExecutingPartyTypes(supabase, itp.projects?.id ?? ""),
    itp.status === "under_review" ? getItpReviewProgress(supabase, itp.id) : Promise.resolve([]),
    // S2-11: plain JAGS staff may approve unless ITP_REQUIRE_APPROVE_PERMISSION=1 (then approve_itp is needed too).
    session.isJagsStaff && !approvePermissionStrict()
      ? Promise.resolve(true)
      : isAdminStaff(session)
        ? Promise.resolve(true)
        : hasPermission(session.userId, "approve_itp", itp.projects?.id),
    loadItpChecklistPreview(supabase, itp.id),
  ]);

  const expectedRecordsByItem = new Map<string, ActivityExpectedRecordRow[]>();
  for (const record of expectedRecords ?? []) {
    const list = expectedRecordsByItem.get(record.itp_item_id) ?? [];
    list.push(record);
    expectedRecordsByItem.set(record.itp_item_id, list);
  }

  const measurementsByItem = new Map<string, ItpItemMeasurementRow[]>();
  for (const row of measurements ?? []) {
    const list = measurementsByItem.get(row.itp_item_id) ?? [];
    list.push(row);
    measurementsByItem.set(row.itp_item_id, list);
  }

  const evidenceDocumentsByItem = new Map<
    string,
    (ItpItemEvidenceDocumentRow & { title: string; documentReference: string | null; status: string | null })[]
  >();
  for (const row of evidenceDocuments ?? []) {
    const list = evidenceDocumentsByItem.get(row.itp_item_id) ?? [];
    list.push({
      ...row,
      title: row.vault_documents?.title ?? "Untitled document",
      documentReference: row.vault_documents?.document_reference ?? null,
      status: row.vault_documents?.status ?? null,
    });
    evidenceDocumentsByItem.set(row.itp_item_id, list);
  }


  const vaultDocuments: VaultDocumentOption[] = (rawVaultDocuments ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    documentReference: d.document_reference,
    storagePath: d.storage_path,
    folderName: d.vault_folders?.name ?? "Document Vault",
    status: d.status,
    revision: d.revision,
    createdAt: d.created_at,
  }));
  const { data: rawVaultFolders } = await supabase
    .from("vault_folders")
    .select("id, folder_key, name")
    .eq("project_id", itp.projects?.id ?? "")
    .order("name")
    .returns<{ id: string; folder_key: string; name: string }[]>();
  const vaultFolders = (rawVaultFolders ?? []).map((f) => ({ id: f.id, key: f.folder_key, name: f.name }));

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

  // Same "which party may execute this activity" rule canExecuteItpItem (lib/checklists/
  // execution-parties.ts) enforces server-side for the evidence_type=2/3 actions — computed here
  // from data already fetched above (interventions/parties/executingPartyTypes) instead of one
  // query per item.
  const ownExecutingPartyIds = new Set(
    (parties ?? [])
      .filter((p) => p.user_id === session.userId && p.is_active && executingPartyTypes.has(p.party_type))
      .map((p) => p.id)
  );
  const itemsWithOwnExecutingIntervention = new Set(
    (interventions ?? []).filter((row) => ownExecutingPartyIds.has(row.project_party_id)).map((row) => row.itp_item_id)
  );
  const canExecuteItemEvidence = (itemId: string) => session.isJagsStaff || itemsWithOwnExecutingIntervention.has(itemId);

  const disciplineByid = new Map((disciplines ?? []).map((d) => [d.id, d.code]));

  // Real bug found live: `interventions`/`signoffs` above are fetched with no itp_item_id filter at
  // all (RLS-scoped to the org, not to this ITP) — so without this filter, every count derived from
  // them below (including the "N of M sign-off points complete" summary) was silently counting every
  // ITP's sign-off rows the viewer has access to, not just this one. Filtering here, once, rather
  // than adding an `.in(...)` to the Promise.all query above, since `allItemIds` itself depends on
  // `sections`, fetched in that same parallel batch — see allItemIds's own comment.
  const ownItemIds = new Set(allItemIds);

  const interventionMap = new Map<string, InterventionLevel>();
  for (const row of interventions ?? []) {
    if (!ownItemIds.has(row.itp_item_id)) continue;
    interventionMap.set(`${row.itp_item_id}:${row.project_party_id}`, row.intervention as InterventionLevel);
  }

  // S4-18: comment / rejection text per sign-off row. Separate best-effort read: the columns come
  // from migration 20261110000300, and a missing column must not break this page.
  const signoffNotes = new Map<string, { signoffComment: string | null; rejectionReason: string | null }>();
  if (!noItems) {
    const { data: noteRows, error: noteError } = await supabase
      .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
      .select("id, signoff_comment, rejection_reason")
      .in("itp_item_id", allItemIds)
      .returns<{ id: string; signoff_comment: string | null; rejection_reason: string | null }[]>();
    if (!noteError) {
      for (const r of noteRows ?? []) {
        if (r.signoff_comment || r.rejection_reason) signoffNotes.set(r.id, { signoffComment: r.signoff_comment, rejectionReason: r.rejection_reason });
      }
    }
  }
  const signoffMap = new Map<string, NonNullable<typeof signoffs>[number]>();
  const ownSignoffs = (signoffs ?? []).filter((row) => ownItemIds.has(row.itp_item_id));
  for (const row of ownSignoffs) {
    signoffMap.set(`${row.itp_item_id}:${row.project_party_id}`, row);
  }

  // Sign-off progress summary (near the page top) and "Notify all pending" gating below — both
  // computed from the same activity_signoff_progress rows already fetched above, filtered to this
  // ITP's own items (see ownSignoffs's comment above) rather than every ITP's rows.
  const signoffTotal = ownSignoffs.length;
  const signoffComplete = ownSignoffs.filter((row) => row.status === "signed_off").length;
  const hasPendingSignoffs = ownSignoffs.some((row) => row.status === "pending");

  // R-quick-fix: surfaces when this ITP's content or sign-off state has changed since the last
  // successfully rendered PDF, so "Regenerate PDF" isn't something you have to remember to click on
  // a hunch — found live: nothing told you the on-disk PDF was stale.
  const lastPdfCompletedAt = latestPdf?.status === "completed" ? latestPdf.completedAt : null;
  const latestSignoffChangeAt = ownSignoffs.reduce<string | null>(
    (latest, row) => (row.updated_at && (!latest || row.updated_at > latest) ? row.updated_at : latest),
    null
  );
  // The later of the two possible causes of staleness — used as the toast's dedupe key
  // (ItpStalePdfToast) so a later change re-fires it even if an earlier staleness was already seen.
  const latestChangeAt = latestSignoffChangeAt && latestSignoffChangeAt > itp.updated_at ? latestSignoffChangeAt : itp.updated_at;
  const isPdfStale =
    !!lastPdfCompletedAt &&
    (new Date(itp.updated_at).getTime() > new Date(lastPdfCompletedAt).getTime() ||
      (latestSignoffChangeAt != null && new Date(latestSignoffChangeAt).getTime() > new Date(lastPdfCompletedAt).getTime()));

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

  // Client-created ITPs (opt-in per project, or org-wide for a Self-Managed/Hybrid or Full
  // Client-Managed client — supabase/migrations/20260918000000_client_itp_creation.sql,
  // 20260918010000_self_managed_engagement_scope.sql, 20260919000000_contractor_itp_creation.sql,
  // and 20260930050000_client_managed_engagement_scope.sql): the originating client OR
  // subcontractor/main_contractor party can populate sections/items/the intervention grid on their
  // own ITP while it's still 'draft' — mirrors is_client_itp_creator() exactly. Bulk-notifying stays
  // a JAGS-only action regardless. Approving is JAGS-only UNLESS this org is on the Full
  // Client-Managed tier AND this person specifically holds the approve_itp custom permission (see
  // canApproveItp below) — a plain Self-Managed ("Hybrid") org still always needs JAGS to approve.
  const isEligibleItpCreator =
    !session.isJagsStaff &&
    itp.status === "draft" &&
    (parties ?? []).some((p) => {
      if (!p.is_active || p.user_id !== session.userId) return false;
      if (p.party_type === "client") {
        return (
          !!itp.projects?.allow_client_itp_creation ||
          itp.projects?.organizations?.engagement_scope === "self_managed" ||
          itp.projects?.organizations?.engagement_scope === "client_managed"
        );
      }
      if (p.party_type === "subcontractor" || p.party_type === "main_contractor") {
        return !!itp.projects?.allow_contractor_itp_creation;
      }
      return false;
    });
  const canEditContent = (session.isJagsStaff || isEligibleItpCreator) && itp.status !== "superseded" && itp.status !== "withdrawn";
  // Other ITPs on the project, for "superseded by" (staff only).
  const { data: siblingItps } = session.isJagsStaff
    ? await supabase.from("itps").select("id, itp_number").eq("project_id", itp.projects?.id ?? "").neq("id", itp.id).order("itp_number").returns<{ id: string; itp_number: string }[]>()
    : { data: [] as { id: string; itp_number: string }[] };
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
  // Once an assigned_acceptor_user_id is set, it narrows further to just that one login — same
  // "never trust the UI alone" discipline, accept_itp() enforces the real restriction itself.
  const isLinkedClientParty = (parties ?? []).some((p) => p.party_type === "client" && p.user_id === session.userId);
  const isAssignedAcceptor = itp.assigned_acceptor_user_id === session.userId;
  const canAccept = itp.status === "approved" && (itp.assigned_acceptor_user_id ? isAssignedAcceptor : isLinkedClientParty);

  // Role-based restriction (R66-R81): a party's sign-off is theirs to give, not anyone's on the
  // project — staff can always countersign, an external user only for the party their own login is
  // linked to via project_parties.user_id, and only while that party is active (see
  // lib/signoff/actions.ts's canSignOffForParty, the server-side twin of this check).
  const canSignOffFor = (partyUserId: string | null, partyIsActive: boolean) =>
    session.isJagsStaff || (partyIsActive && !!partyUserId && partyUserId === session.userId);

  const hasActiveReviewChain = reviewSteps.length > 0 && reviewSteps.some((s) => s.status === "pending");

  // Full Client-Managed tier's approval half: a non-staff person can Approve only when they hold
  // the approve_itp custom-role permission on this project — RLS (itps_u,
  // 20260930050000_client_managed_engagement_scope.sql) is the real gate; this only decides whether
  // the button renders at all. Never true for a plain Self-Managed ("Hybrid") org, since that tier
  // has no way to be granted this permission key (see CLIENT_MANAGED_ONLY_PERMISSION_KEYS).

  // The checklist is part of the ITP: it is loaded once and used both to show it and to gate
  // approval/acceptance on the reviewer confirming they have looked at it.
  const requiresChecklistReview = checklistPreview.some((i) => i.hasChecklist);
  // Admin-only escape hatch: who a stuck (pending) review step can be handed to - active JAGS staff.
  // Loaded only for an Admin looking at an ITP that is under review.
  const reassignOptions: { id: string; name: string }[] =
    isAdminStaff(session) && hasActiveReviewChain
      ? ((
          await supabase
            .from("users")
            .select("id, full_name")
            .eq("is_jags_staff", true)
            .eq("is_active", true)
            .order("full_name")
            .returns<{ id: string; full_name: string }[]>()
        ).data ?? []).map((u) => ({ id: u.id, name: u.full_name }))
      : [];
  // S3-06: each activity's explicit register requirement, read separately and best-effort so the page
  // still renders if that column isn't there.
  const requiredRegistersByItem = new Map<string, string[]>();
  {
    const itemIds = (sections ?? []).flatMap((s) => (s.itp_items ?? []).map((it) => it.id));
    if (itemIds.length > 0) {
      const { data: reqRows, error: reqError } = await supabase
        .from("itp_items")
        .select("id, required_registers" as never)
        .in("id", itemIds)
        .returns<{ id: string; required_registers: string[] | null }[]>();
      if (!reqError) for (const r of reqRows ?? []) requiredRegistersByItem.set(r.id, normaliseRequiredRegisters(r.required_registers));
    }
  }
  // Per-activity checklist for the clickable "Checklist" pill in the grid below.
  const checklistByItem = new Map(
    checklistPreview
      .filter((i) => i.hasChecklist)
      .map((i) => [
        i.itemId,
        {
          number: i.generated?.number ?? null,
          lines: i.generated?.lines.length ? i.generated.lines : i.previewLines.map((text) => ({ text, mandatory: true })),
        },
      ])
  );

  return (
    <div>
      {/* Live cross-party updates: another party's sign-off, or a status/section change, refreshes
          this page automatically instead of requiring a manual reload — the point of the intervention
          grid being multi-party in the first place. Unfiltered on this table (small per-ITP volume;
          Supabase Realtime filters only support simple equality, and this page's relevant rows span
          several itp_item_ids with no single column to filter on cheaply). */}
      <RealtimeRefresh table="activity_signoff_progress" also={[{ table: "itps", filter: `id=eq.${id}` }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {embedded ? <span /> : (
          <Link href="/inspect/itps" className="text-sm text-burgundy hover:underline">
          ← Back to ITP Register
          </Link>
        )}
        <Link
          href={`/inspect/projects/${itp.projects?.id}/guide`}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-off-white"
        >
          ? Project Guide
        </Link>
      </div>
      {itp.revision_needs_approval && (itp.status === "approved" || itp.status === "client_accepted") && (
        <div className="mt-3 rounded-md border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-ink" role="status">
          <p className="font-medium">Revision {itp.revision} is awaiting approval</p>
          <p className="mt-0.5 text-xs text-muted">
            This ITP was changed after it was issued. The change is recorded in the revision history; someone other than the person who made
            it needs to approve the new revision.
          </p>
          {canApproveItp && <ApproveRevisionForm itpId={itp.id} revision={itp.revision} />}
        </div>
      )}
      {itp.status === "draft" && canSubmitForReview && (() => {
        const allItems = (sections ?? []).flatMap((s) => s.itp_items ?? []);
        if (allItems.length === 0) return null;
        const withoutCriteria = allItems.filter((i) => !i.acceptance_criteria?.trim()).length;
        const withoutLevels = allItems.filter((i) => !(parties ?? []).some((p) => interventionMap.has(`${i.id}:${p.id}`))).length;
        const hasHold = allItems.some((i) => (parties ?? []).some((p) => interventionMap.get(`${i.id}:${p.id}`) === "H"));
        const warnings = [
          withoutCriteria > 0 ? `${withoutCriteria} activit${withoutCriteria === 1 ? "y has" : "ies have"} no acceptance criteria` : null,
          withoutLevels > 0 ? `${withoutLevels} activit${withoutLevels === 1 ? "y has" : "ies have"} no sign-off level for any party` : null,
          !hasHold ? "no Hold point is set on any activity" : null,
        ].filter(Boolean);
        if (warnings.length === 0) return null;
        return (
          <div className="mt-3 rounded-md border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-ink" role="status">
            <p className="font-medium">Before you submit for review</p>
            <ul className="mt-1 list-disc ps-5 text-xs text-muted">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted">These don&apos;t block submission, but reviewers will usually expect them filled in.</p>
          </div>
        );
      })()}
      {itp.status === "draft" && itp.returned_reason && (
        <div className="mt-3 rounded-md border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-ink" role="status">
          <p className="font-medium text-danger">Returned for changes</p>
          <p className="mt-0.5 whitespace-pre-line">{itp.returned_reason}</p>
          {itp.returned_at && <p className="mt-1 text-xs text-muted">{new Date(itp.returned_at).toLocaleString("en-GB")}</p>}
        </div>
      )}
      {exitNotice && (
        <div className="mt-3 rounded-md border border-border bg-off-white px-4 py-3 text-sm text-ink" role="status" data-testid="itp-exit-notice">
          <p className="font-medium">{exitNotice.heading}</p>
          <p className="mt-0.5 whitespace-pre-line">Reason: {exitNotice.reason}</p>
          {replacementItp && (
            <p className="mt-1">
              Replaced by{" "}
              <Link href={`/inspect/itps/${replacementItp.id}`} className="text-burgundy hover:underline">
                {replacementItp.itp_number} — {replacementItp.title}
              </Link>
            </p>
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Heading className="doc-id text-2xl font-semibold text-ink">{itp.itp_number}</Heading>
            <PageGuide
              title="ITP detail — how this works"
              points={[
                "The H/W/R/S grid records which party intervenes at what level on each activity (Hold/Witness/Review/Surveillance, or a custom level your org configures) — a blocking level (e.g. Hold) stops the next step until that party signs off.",
                "A party can only sign off their own intervention point: staff can always countersign, but an external login can only sign for the project party their account is linked to, and only while that party is active.",
                "Editing content (sections/items/the grid) is allowed on a 'draft' ITP for JAGS staff, or for the client/contractor party that originated it if their project opted them into ITP creation — approving is JAGS-only for a Full-Service or Self-Managed (\"Hybrid\") client, but on a Full Client-Managed client a person who specifically holds the approve_itp permission can approve it themselves too.",
                "Once the ITP is approved or client-accepted, adding items/sections counts as an edit-after-issue and bumps the revision, with a frozen snapshot kept in revision history.",
                "Checklists → and Completion roadmap → are separate pages: this page is where content, sign-offs and evidence are actually recorded; those summarise status without duplicating the forms.",
                "Recording evidence (checklist answers, measurements, or linking a document) follows the same rule as sign-off: staff can always do it, the party actually assigned to that activity can self-execute it (client only if your project opted them in), and a TPI/lab party never can — it can only sign off its own witness/review cells.",
              ]}
            />
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
                    ? `Reviewed by ${aiDraftReview.users?.full_name ?? "a reviewer"} on ${new Date(aiDraftReview.reviewed_at).toLocaleDateString("en-GB")}`
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
          {(await isAiEnabledForOrg(supabase, itp.projects?.organization_id)) && <TranslateContentPanel itpId={itp.id} revision={itp.revision} stored={parseItpTranslations(itp.translations)} />}
          {session.isJagsStaff && <ItpExitControls itpId={itp.id} status={itp.status} siblingItps={siblingItps ?? []} />}
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

        <ItpStalePdfToast isStale={isPdfStale} changedAt={latestChangeAt} />

        <div className="flex flex-wrap gap-2">
          <ItpPdfButton
            itpId={itp.id}
            latest={latestPdf}
            extraActions={
              <>
                {/* R41: export the ITP's current content as an editable .xlsx —
                    offline-revision-form.tsx below is the matching re-upload half of this round
                    trip. Available to anyone who can view the ITP; the re-upload side is
                    staff-only. */}
                <DropdownMenuItem>
                  <ExportLink href={`/api/itps/${itp.id}/export-xlsx`} pendingLabel="Preparing…">
                    Download for offline editing
                  </ExportLink>
                </DropdownMenuItem>
                {/* R107: a plain Word copy of the controlled ITP (sections/items + intervention
                    grid), stamped "UNCONTROLLED COPY" — see
                    app/api/itps/[id]/export-docx/route.ts. */}
                <DropdownMenuItem>
                  <ExportLink href={`/api/itps/${itp.id}/export-docx`} pendingLabel="Preparing…">
                    Word
                  </ExportLink>
                </DropdownMenuItem>
              </>
            }
          />
          {!embedded && (
            <>
              {/* Added by the checklists/inspections slice — links to the new /checklists route added in that feature, no other change to this file. */}
              <Link
                href={`/inspect/itps/${itp.id}/checklists`}
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
              >
                Checklists →
              </Link>
              <Link
                href={`/inspect/itps/${itp.id}/status`}
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
              >
                Completion roadmap →
              </Link>
              <Link
                href={`/inspect/itps/${itp.id}/approval-roadmap`}
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
              >
                Approval roadmap →
              </Link>
            </>
          )}
          {canSubmitForReview && <AdvanceStatusForm itpId={itp.id} fromStatus="draft" />}
          {canApproveItp && itp.status === "under_review" && !hasActiveReviewChain && (
            <AdvanceStatusForm itpId={itp.id} fromStatus="under_review" requiresChecklistReview={requiresChecklistReview} />
          )}
          {itp.status === "under_review" && (canApproveItp || session.isJagsStaff) && <ReturnItpForm itpId={itp.id} />}
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
          {canAccept && <AcceptItpForm itpId={itp.id} requiresChecklistReview={requiresChecklistReview} />}
          {/* Added for the "propose to master library" action (Reqs R31) — only shown once the ITP
              has reached approved/client_accepted, matching this file's existing status gating. */}
          {canPropose && (
            <ProposeToMasterForm itpId={itp.id} itpTitle={itp.title} masterTemplates={masterTemplates ?? []} />
          )}
        </div>
      </div>

      {/* Moved out of the wrapping header row and given its own full-width line right below the
          header (redesign target, plan Phase 4): while an ITP is under review this is the single
          most important thing on the page — who's up next and whether it's this viewer's turn —
          so it shouldn't be competing for space inside a flex-wrap row of action buttons. */}
      {reviewSteps.length > 0 && (
        <div className="mt-4">
          <ReviewChainStatus itpId={itp.id} steps={reviewSteps} currentUserId={session.userId} isAdminStaff={session.isJagsStaff} requiresChecklistReview={requiresChecklistReview} reassignOptions={reassignOptions} />
        </div>
      )}

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

      <RevisionHistoryPanel revisions={revisions ?? []} currentRevision={itp.revision} awaitingApproval={itp.revision_needs_approval} />
      <ReviewHistoryPanel itpId={itp.id} />

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

      {/* The checklist is part of the ITP, not a separate thing: whoever reviews/approves/accepts this
          ITP can open it right here (real checklists once approved; before that, what each activity's
          checklist will start from). Open by default while the ITP is waiting on a decision. */}
      <details className="mt-6 rounded-lg border border-border bg-surface px-4 py-2" open={itp.status === "under_review" || itp.status === "approved"}>
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink">
          Checklists that go with this ITP
        </summary>
        <div className="pb-3">
          <ItpChecklistPreview
            items={checklistPreview}
            approved={itp.status === "approved" || itp.status === "client_accepted"}
          />
        </div>
      </details>

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
                referenceSpec: item.reference_spec,
                method: item.method,
                frequency: item.frequency,
                evidenceLabel: EVIDENCE_LABEL[item.evidence_type],
                evidenceType: item.evidence_type,
                checklist: checklistByItem.get(item.id) ?? null,
                disciplineId: item.discipline_id,
                disciplineCode: item.discipline_id ? disciplineByid.get(item.discipline_id) ?? null : null,
                // R25: per-activity override, checked before the level-keyed noticeHours map below.
                noticeHoursOverride: item.notice_hours_override,
                plannedDate: item.planned_date,
                requiredRegisters: requiredRegistersByItem.get(item.id) ?? [],
                partyCells: (parties ?? []).map((party) => {
                  const intervention = interventionMap.get(`${item.id}:${party.id}`) ?? null;
                  const signoff = signoffMap.get(`${item.id}:${party.id}`) ?? null;
                  return {
                    party,
                    intervention,
                    signoff: signoff ? { ...signoff, ...(signoffNotes.get(signoff.id) ?? {}) } : null,
                    canSignOff: canSignOffFor(party.user_id, party.is_active),
                  };
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
                    disciplines={disciplines ?? []}
                    isIssued={isIssued}
                  />
                  {/* R54-R56: expected -> received third-party test record tracking per activity —
                      kept as its own per-activity block below the grid, since it isn't part of the
                      per-party intervention/sign-off grid itself. */}
                  <div>
                    {sortedItems.map((item) => (
                      <div key={item.id} className="border-b border-border px-4 py-3 last:border-0 bg-off-white/40">
                        <p className="mb-1.5 text-xs font-medium text-muted">
                          <span className="doc-id me-1">{item.item_number}</span>
                          {item.activity}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          <ActivityEvidenceToggle
                            label={`Expected records${(expectedRecordsByItem.get(item.id) ?? []).length > 0 ? ` (${(expectedRecordsByItem.get(item.id) ?? []).length})` : ""}`}
                          >
                            <ExpectedRecordsSection
                              itpItemId={item.id}
                              records={expectedRecordsByItem.get(item.id) ?? []}
                              canAdd={session.isJagsStaff}
                              canMarkReceivedByProvider={canMarkReceivedByProvider}
                              projectId={itp.projects?.id ?? ""}
                              vaultDocuments={vaultDocuments}
                            />
                          </ActivityEvidenceToggle>
                          {item.evidence_type === 3 && (
                            <ActivityEvidenceToggle
                              label={`Measurements${(measurementsByItem.get(item.id) ?? []).length > 0 ? ` (${(measurementsByItem.get(item.id) ?? []).length})` : ""}`}
                            >
                              <ItpItemMeasurementsSection
                                itpItemId={item.id}
                                measurements={measurementsByItem.get(item.id) ?? []}
                                canRecord={canExecuteItemEvidence(item.id)}
                              />
                            </ActivityEvidenceToggle>
                          )}
                          {item.evidence_type === 2 && (
                            <ActivityEvidenceToggle
                              label={`Evidence documents${(evidenceDocumentsByItem.get(item.id) ?? []).length > 0 ? ` (${(evidenceDocumentsByItem.get(item.id) ?? []).length})` : ""}`}
                            >
                              <ItpItemEvidenceDocumentsSection
                                itpItemId={item.id}
                                documents={evidenceDocumentsByItem.get(item.id) ?? []}
                                vaultDocuments={vaultDocuments}
                                projectId={itp.projects?.id ?? ""}
                                vaultFolders={vaultFolders}
                                canLink={canExecuteItemEvidence(item.id)}
                              />
                            </ActivityEvidenceToggle>
                          )}
                        </div>
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
                suggestedItemNumber={`${section.section_number}.${(section.itp_items ?? []).length + 1}`}
                disciplines={disciplines ?? []}
                isIssued={isIssued}
                drawingDocuments={drawingDocuments}
                parties={(parties ?? []).filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name }))}
                levels={levels.map((l) => ({ code: l.code, label: l.label }))}
              />
            )}
            {canEditContent && <BulkAddItemsForm itpId={itp.id} sectionId={section.id} isIssued={isIssued} />}
          </div>
        ))}
      </div>

      {canEditContent && <AddSectionForm itpId={itp.id} isIssued={isIssued} />}
    </div>
  );
}

export type ItpPane = "details" | "checklists" | "status" | "approval-roadmap";

const PANES: { key: ItpPane; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "checklists", label: "Checklists" },
  { key: "status", label: "Completion" },
  { key: "approval-roadmap", label: "Approval" },
];

function PaneSkeleton() {
  return (
    <div className="mt-4 space-y-3" aria-busy="true" aria-label="Loading section">
      <div className="h-8 w-56 animate-pulse rounded bg-off-white" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-md bg-off-white" />
      ))}
    </div>
  );
}

/**
 * The ITP detail. Full page: just the details (with links to the sub-pages). Embedded in the
 * register split: a tab strip (`?pane=`) switches between details, checklists, completion and
 * approval roadmaps inside the same window, so nothing navigates away.
 */
export async function ItpDetailView({
  id,
  embedded = false,
  pane = "details",
  baseQuery = "",
}: {
  id: string;
  embedded?: boolean;
  pane?: ItpPane;
  /** Embedded only: the register's current query string (filters, `itp`), without `pane`. */
  baseQuery?: string;
}) {
  if (!embedded) return <ItpDetailBody id={id} />;
  const active: ItpPane = PANES.some((p) => p.key === pane) ? pane : "details";
  const hrefFor = (key: ItpPane) => {
    const sp = new URLSearchParams(baseQuery);
    sp.delete("pane");
    if (key !== "details") sp.set("pane", key);
    const q = sp.toString();
    return `/inspect/itps${q ? `?${q}` : ""}`;
  };
  return (
    <div>
      <nav aria-label="ITP sections" className="border-b border-border">
        <ul className="flex snap-x gap-1 overflow-x-auto [scrollbar-width:thin]">
          {PANES.map((p) => {
            const isActive = p.key === active;
            return (
              <li key={p.key} className="snap-start">
                <Link
                  href={hrefFor(p.key)}
                  scroll={false}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors sm:px-4",
                    isActive ? "border-burgundy text-burgundy" : "border-transparent text-muted hover:text-ink"
                  )}
                >
                  {p.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-4">
        <Suspense key={`${id}:${active}`} fallback={<PaneSkeleton />}>
          {active === "checklists" ? (
            <ChecklistsView id={id} embedded />
          ) : active === "status" ? (
            <StatusView id={id} embedded baseQuery={baseQuery} />
          ) : active === "approval-roadmap" ? (
            <ApprovalRoadmapView id={id} embedded />
          ) : (
            <ItpDetailBody id={id} embedded />
          )}
        </Suspense>
      </div>
    </div>
  );
}
