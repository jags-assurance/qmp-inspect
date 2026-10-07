import { PROJECT_PARTY_MEMBERS_TABLE } from "@/lib/projects/party-access-types";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import {
  CHECKLIST_ITEMS_TABLE,
  CHECKLIST_RESPONSES_TABLE,
  CHECKLIST_TEMPLATES_TABLE,
  INSPECTION_EVIDENCE_DOCUMENTS_TABLE,
  INSPECTION_PHOTOS_TABLE,
  INSPECTION_RECORDS_TABLE,
  type ChecklistItemRow,
  type ChecklistResponseRow,
  type InspectionPhotoRow,
  type InspectionRecordRow,
} from "@/lib/checklists/db-types";
import { VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";
import { InspectionEvidenceDocuments } from "./inspection-evidence-documents";
import { EvidenceMissingNotice } from "./evidence-missing-notice";
import {
  checkPersonnelCertification,
  checkRegisterVerification,
  listCalibrationOptions,
  listMaterialOptions,
  listWelderOptions,
  type RegisterVerificationResult,
} from "@/lib/registers/verify";
import { ChecklistExecutionPanel } from "./checklist-execution-panel";
import { AddChecklistItemForm } from "./add-checklist-item-form";
import { TemplateItemsEditor } from "./template-items-editor";
import { TemplateLifecycleControls } from "./template-lifecycle-controls";
import { countTemplateRecords, countTemplateResponses } from "@/lib/checklists/template-context";
import { loadDuplicateTargets } from "@/lib/checklists/duplicate-targets";
import { itemEditBlockReason, templateDeleteBlockReason } from "@/lib/checklists/template-ui-logic";
import { StartInspectionForm } from "./start-inspection-form";
import { getNoticeCheck } from "@/lib/signoff/notice-check";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { PhotoUpload } from "./photo-upload";
import { CompleteInspectionForm } from "./complete-inspection-form";
import { ConsistencyCheck } from "./consistency-check";
import { getExecutingPartyTypes } from "@/lib/checklists/execution-parties";
import { getLocationPresetsForProject } from "@/lib/checklists/location-presets";
import { canCompleteInspection } from "@/lib/signoff/actions";
import { getSignedPhotoUrls } from "@/lib/storage/signed-urls";
import { PageGuide } from "@/components/domain/page-guide";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE } from "@/lib/signoff/db-types";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";

// Kept in sync by hand with the same map on the project detail page and elsewhere in this app (no
// shared lib for it — see that page's own comment on the same duplication).
const PARTY_TYPE_LABEL: Record<string, string> = {
  client: "Client",
  main_contractor: "Main Contractor",
  subcontractor: "Subcontractor",
  tpi_lab: "TPI / Lab",
  vendor: "Vendor",
  jags: "JAGS Assurance",
};

/**
 * Field execution surface for one checklist: shows any in-progress inspection to keep filling in,
 * or a "Start inspection" prompt if there isn't one, plus the checklist's own item list (staff can
 * extend it here, matching the ITP add-item pattern).
 */
export default async function ChecklistFillPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: template } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select(
      "id, checklist_number, name, itp_items(id, item_number, activity, reference_spec, acceptance_criteria, itp_sections(itps(id, itp_number, status, projects(id, name, organization_id, enforce_hold_blocks_start, organizations(name)))))"
    )
    .eq("id", templateId)
    .maybeSingle<{
      id: string;
      checklist_number: string;
      name: string;
      itp_items: {
        id: string;
        item_number: string;
        activity: string;
        reference_spec: string | null;
        acceptance_criteria: string | null;
        itp_sections: {
          itps: {
            id: string;
            itp_number: string;
            status: string;
            projects: {
              id: string;
              name: string;
              organization_id: string;
              enforce_hold_blocks_start: boolean;
              organizations: { name: string } | null;
            } | null;
          } | null;
        } | null;
      } | null;
    }>();

  if (!template) notFound();

  const itpItem = template.itp_items;
  const itp = itpItem?.itp_sections?.itps;
  const project = itp?.projects;
  if (!itpItem || !itp || !project) notFound();

  // R76: "the originator (typically the subcontractor/contractor) raises the inspection request" —
  // self-inspection is that party's own spec'd role, not JAGS staff's alone. But holding SOME
  // intervention level on the activity isn't enough on its own: an independent verifier (TPI/lab
  // holding a Hold/Witness point) or the project owner (client holding a Review point) exists on the
  // grid specifically to check someone else's work after the fact — they don't do the field data
  // entry themselves, or the independent-verification point is meaningless. Only the party actually
  // performing/self-inspecting the work — subcontractor or main contractor — can run the checklist;
  // client and tpi_lab are sign-off-only, UNLESS this project has opted into
  // projects.allow_client_execution (piece 4 of the teams/delegation work — see
  // lib/checklists/execution-parties.ts, also used by lib/checklists/actions.ts so the UI and the
  // actual server-side gate can never drift apart), in which case client joins the executing set too.
  // Perf: neither query depends on the other's result — both only need project.id/itpItem.id,
  // already in hand — so run them together instead of two sequential round trips on this page,
  // the single most-visited one in the app (every checklist fill hits it).
  const [EXECUTING_PARTY_TYPES, { data: stakeholderParties }] = await Promise.all([
    getExecutingPartyTypes(supabase, project.id),
    supabase
      .from("activity_party_intervention")
      .select("project_parties(id, name, user_id, party_type, is_active)")
      .eq("itp_item_id", itpItem.id)
      .returns<{ project_parties: { id: string; name: string; user_id: string | null; party_type: string; is_active: boolean } | null }[]>(),
  ]);
  // is_active gates this the same way it now gates the server-side action (canExecuteItpItem
  // in lib/checklists/actions.ts) — a deactivated party shouldn't see live Yes/No/N-A buttons that the
  // server would reject anyway.
  // Team members of a party (project_party_members) act for it too - the server gate already counts them.
  const stakeholderPartyIds = (stakeholderParties ?? []).map((r) => r.project_parties?.id).filter((v): v is string => !!v);
  const memberPartyIds = new Set<string>();
  if (stakeholderPartyIds.length > 0) {
    const { data: memberRows } = await supabase
      .from(PROJECT_PARTY_MEMBERS_TABLE)
      .select("project_party_id")
      .eq("user_id", session.userId)
      .in("project_party_id", stakeholderPartyIds)
      .returns<{ project_party_id: string }[]>();
    for (const m of memberRows ?? []) memberPartyIds.add(m.project_party_id);
  }
  const isOwnParty = (row: { project_parties: { id: string; user_id: string | null } | null }) =>
    row.project_parties?.user_id === session.userId || (!!row.project_parties && memberPartyIds.has(row.project_parties.id));
  const isAssignedParty = (stakeholderParties ?? []).some(
    (row) =>
      isOwnParty(row) &&
      row.project_parties!.is_active &&
      EXECUTING_PARTY_TYPES.has(row.project_parties!.party_type)
  );
  // Distinguishes "you hold a sign-off point here but don't do field entry" from "your party isn't
  // on this activity at all" — both land on !isAssignedParty, but the guidance differs.
  const isSignoffOnlyParty = (stakeholderParties ?? []).some(
    (row) =>
      isOwnParty(row) &&
      row.project_parties!.is_active &&
      !EXECUTING_PARTY_TYPES.has(row.project_parties!.party_type)
  );
  // R92-R100 personnel-cert soft-stop: which project_party's certifications to check. Same
  // resolution as isAssignedParty above — the executing party is whichever subcontractor/main_
  // contractor row on this activity is linked to the CURRENT signed-in user, since they're the one
  // about to record the response. There can be more than one qualifying party on an activity (e.g. a
  // subcontractor and main_contractor both intervening) but at most one of them is ever "you," so
  // this is unambiguous. Null when the signed-in user has no such party link (e.g. JAGS staff running
  // the inspection directly) — checkPersonnelCertification treats that as "not applicable."
  const executingProjectPartyId =
    (stakeholderParties ?? []).find(
      (row) =>
        row.project_parties?.user_id === session.userId &&
        row.project_parties.is_active &&
        EXECUTING_PARTY_TYPES.has(row.project_parties.party_type)
    )?.project_parties?.id ?? null;

  // Whether the viewer is linked to SOME project party at all — used to tell "you're a project
  // party, just not this activity's" apart from "you have no party link on this project," since the
  // former reads as a dead end otherwise (see the not-canExecute message below).
  // Perf: none of these four filters only by templateId/project.id/session.userId — nothing here
  // depends on another's result — so batch them instead of four sequential round trips.
  const [{ data: ownPartyLink }, { data: items }, { data: draftRecords }, { data: pastRecords }] = await Promise.all([
    session.isJagsStaff
      ? Promise.resolve({ data: null as { id: string } | null })
      : supabase
          .from("project_parties")
          .select("id")
          .eq("project_id", project.id)
          .eq("user_id", session.userId)
          .maybeSingle<{ id: string }>(),
    supabase
      .from(CHECKLIST_ITEMS_TABLE)
      .select("id, item_number, description, is_mandatory, sort_order")
      .eq("template_id", templateId)
      .order("sort_order")
      .returns<Pick<ChecklistItemRow, "id" | "item_number" | "description" | "is_mandatory" | "sort_order">[]>(),
    supabase
      .from(INSPECTION_RECORDS_TABLE)
      .select("id, location, inspection_date, created_at")
      .eq("checklist_template_id", templateId)
      .is("overall_result", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<Pick<InspectionRecordRow, "id" | "location" | "inspection_date" | "created_at">[]>(),
    supabase
      .from(INSPECTION_RECORDS_TABLE)
      .select("id, record_number, overall_result, inspection_date")
      .eq("checklist_template_id", templateId)
      .not("overall_result", "is", null)
      .order("created_at", { ascending: false })
      .returns<Pick<InspectionRecordRow, "id" | "record_number" | "overall_result" | "inspection_date">[]>(),
  ]);

  const draft = draftRecords?.[0] ?? null;

  // Version / archive state. Read separately from the main template query so the page still works
  // before the versioning migration (20261106000100) is applied (error -> unversioned, active).
  const { data: lifecycleRow, error: lifecycleError } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select("version, archived_at")
    .eq("id", templateId)
    .maybeSingle<{ version: number | null; archived_at: string | null }>();
  const templateVersion = lifecycleError ? null : (lifecycleRow?.version ?? null);
  const archived = lifecycleError ? false : !!lifecycleRow?.archived_at;
  const showEditor = session.isJagsStaff;
  const [responseCount, recordCount, duplicateTargets] = showEditor
    ? await Promise.all([
        countTemplateResponses(supabase, templateId),
        countTemplateRecords(supabase, templateId),
        archived ? Promise.resolve([]) : loadDuplicateTargets(supabase, project.id, itpItem.id),
      ])
    : [0, 0, []];
  const editBlockReason = itemEditBlockReason({ archived, responseCount });

  let responseByItem = new Map<
    string,
    {
      result: "yes" | "no" | "na";
      comment: string | null;
      calibrationAssetId: string | null;
      materialId: string | null;
      welderId: string | null;
      updatedAt?: string | null;
      noNcrReason?: string | null;
    }
  >();
  // Photos with a null checklist_item_id go to the generic whole-inspection section (unchanged
  // behaviour); photos linked to a specific item are grouped here and handed to that item's row.
  let photos: { id: string; storage_path: string; caption: string | null; url: string | null }[] = [];
  let itemPhotos = new Map<string, { id: string; storage_path: string; caption: string | null; url: string | null }[]>();
  let registerVerification: RegisterVerificationResult | null = null;
  let personnelCertVerification: RegisterVerificationResult | null = null;
  let calibrationOptions: { id: string; instrument_name: string; cert_number: string; status: string }[] = [];
  let materialOptions: { id: string; material_description: string; heat_number: string | null; batch_number: string | null }[] = [];
  let welderOptions: { id: string; welder_identifier: string; qualified_wps: string; status: string }[] = [];
  // At least one evidence photo OR linked Vault document (whole-inspection or item-linked) is
  // required to complete — see completeInspectionCore's matching server-side check, this only
  // drives which slot renders.
  let hasEvidencePhoto = false;
  let evidenceDocuments: { id: string; vaultDocumentId: string; title: string; documentReference: string | null }[] = [];
  let vaultDocumentOptions: import("@/components/domain/vault-file-picker").VaultPickerDocument[] = [];
  let vaultFolderOptions: import("@/components/domain/vault-file-picker").VaultPickerFolder[] = [];

  const itemDocuments = new Map<string, import("./item-documents").ItemLinkedDocument[]>();
  let hasNcr = false;
  if (draft) {
    const { count: ncrCount } = await supabase
      .from("ncrs")
      .select("id", { count: "exact", head: true })
      .eq("inspection_record_id", draft.id);
    hasNcr = !!ncrCount;
  }

  if (draft) {
    const [{ data: responses }, { data: photoRows }, { data: evidenceDocRows }, { data: rawVaultDocuments }] = await Promise.all([
      supabase
        .from(CHECKLIST_RESPONSES_TABLE)
        .select("checklist_item_id, result, comment, calibration_asset_id, material_id, welder_id, updated_at, no_ncr_reason")
        .eq("inspection_record_id", draft.id)
        .returns<
          (Pick<
            ChecklistResponseRow,
            "checklist_item_id" | "result" | "comment" | "calibration_asset_id" | "material_id" | "welder_id"
          > & { updated_at: string; no_ncr_reason: string | null })[]
        >(),
      supabase
        .from(INSPECTION_PHOTOS_TABLE)
        .select("id, storage_path, caption, checklist_item_id")
        .eq("inspection_record_id", draft.id)
        .returns<Pick<InspectionPhotoRow, "id" | "storage_path" | "caption" | "checklist_item_id">[]>(),
      supabase
        .from(INSPECTION_EVIDENCE_DOCUMENTS_TABLE)
        .select("id, vault_document_id, checklist_item_id, vault_documents(title, document_reference, status)")
        .eq("inspection_record_id", draft.id)
        .returns<{ id: string; vault_document_id: string; checklist_item_id: string | null; vault_documents: { title: string; document_reference: string | null; status: string } | null }[]>(),
      supabase
        .from(VAULT_DOCUMENTS_TABLE)
        .select("id, title, document_reference, revision, status, created_at, storage_path, vault_folders!inner(project_id, name)")
        .eq("vault_folders.project_id", project.id)
        .in("status", ["approved", "for_review", "rejected"])
        .order("title")
        .returns<{ id: string; title: string; document_reference: string | null; revision: string | null; status: string; created_at: string; storage_path: string | null; vault_folders: { name: string } | null }[]>(),
    ]);
    const { data: rawVaultFolders } = await supabase
      .from("vault_folders")
      .select("id, folder_key, name")
      .eq("project_id", project.id)
      .order("name")
      .returns<{ id: string; folder_key: string; name: string }[]>();
    vaultFolderOptions = (rawVaultFolders ?? []).map((f) => ({ id: f.id, key: f.folder_key, name: f.name }));
    for (const d of evidenceDocRows ?? []) {
      if (!d.checklist_item_id) continue;
      const list = itemDocuments.get(d.checklist_item_id) ?? [];
      list.push({
        linkId: d.id,
        vaultDocumentId: d.vault_document_id,
        title: d.vault_documents?.title ?? "Untitled document",
        documentReference: d.vault_documents?.document_reference ?? null,
        status: d.vault_documents?.status ?? "for_review",
      });
      itemDocuments.set(d.checklist_item_id, list);
    }
    evidenceDocuments = (evidenceDocRows ?? []).map((d) => ({
      id: d.id,
      vaultDocumentId: d.vault_document_id,
      title: d.vault_documents?.title ?? "Untitled document",
      documentReference: d.vault_documents?.document_reference ?? null,
    }));
    vaultDocumentOptions = (rawVaultDocuments ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      documentReference: d.document_reference,
      folderName: d.vault_folders?.name ?? "Document Vault",
      revision: d.revision,
      status: d.status,
      createdAt: d.created_at,
      storagePath: d.storage_path,
    }));
    responseByItem = new Map(
      (responses ?? []).map((r) => [
        r.checklist_item_id,
        {
          result: r.result,
          comment: r.comment,
          calibrationAssetId: r.calibration_asset_id,
          materialId: r.material_id,
          welderId: r.welder_id,
          updatedAt: r.updated_at,
          noNcrReason: r.no_ncr_reason,
        },
      ])
    );
    // Perf: one batched Storage call for every photo's signed URL on this checklist (across both
    // the whole-inspection section and every item's own photos) instead of each <PhotoThumbnail>
    // fetching its own client-side (see lib/storage/signed-urls.ts's doc comment).
    const photoUrls = await getSignedPhotoUrls(
      supabase,
      "inspection-evidence",
      (photoRows ?? []).map((p) => p.storage_path)
    );
    const withUrl = (p: Pick<InspectionPhotoRow, "id" | "storage_path" | "caption" | "checklist_item_id">) => ({
      ...p,
      url: photoUrls.get(p.storage_path) ?? null,
    });
    photos = (photoRows ?? []).filter((p) => !p.checklist_item_id).map(withUrl);
    itemPhotos = new Map();
    for (const p of photoRows ?? []) {
      if (!p.checklist_item_id) continue;
      const existing = itemPhotos.get(p.checklist_item_id) ?? [];
      existing.push(withUrl(p));
      itemPhotos.set(p.checklist_item_id, existing);
    }
    hasEvidencePhoto = (photoRows ?? []).length > 0 || evidenceDocuments.length > 0;

    // R92-R100: register-fed auto-verification — a soft-stop assist, not a hard block. Computed
    // once per checklist (the same itp_items row backs every checklist_items row here), then shown
    // inline on every response row below. Genuinely parallel (not just labeled that way): neither
    // check consumes the other's result, so run them together.
    [registerVerification, personnelCertVerification] = await Promise.all([
      checkRegisterVerification(supabase, {
        projectId: project.id,
        itpItemReferenceSpec: itpItem.reference_spec,
        itpItemAcceptanceCriteria: itpItem.acceptance_criteria,
        itpItemId: itpItem.id,
      }),
      checkPersonnelCertification(supabase, {
        projectId: project.id,
        executingProjectPartyId,
        executingUserId: session.userId,
        itpItemReferenceSpec: itpItem.reference_spec,
        itpItemAcceptanceCriteria: itpItem.acceptance_criteria,
        itpItemId: itpItem.id,
      }),
    ]);

    if (registerVerification?.kind === "calibration") {
      calibrationOptions = await listCalibrationOptions(supabase, project.id);
    } else if (registerVerification?.kind === "material") {
      materialOptions = await listMaterialOptions(supabase, project.id);
    } else if (registerVerification?.kind === "welder") {
      welderOptions = await listWelderOptions(supabase, project.id);
    }
  }

  // Field execution (starting/answering/completing a checklist) is JAGS staff's job — the actual
  // field officer running the inspection — either JAGS staff, or (R76) the performing contractor
  // (subcontractor/main contractor) self-inspecting their own section. An independent verifier
  // (TPI/lab), the client, or an unrelated party still can't — see EXECUTING_PARTY_TYPES above.
  // Everyone with project access can still VIEW the checklist and its past results.
  const canExecute = session.isJagsStaff || isAssignedParty;

  // R71: "a hold point must wait" — a still-open Hold on this activity holds the physical work
  // itself, not just its paperwork, so the "Start inspection" prompt is replaced with an explicit
  // explanation rather than letting the field officer start filling in items that startInspectionAction
  // (lib/checklists/actions.ts) will refuse to persist anyway once they hit "Start". Only computed
  // when it would actually matter (no draft yet, otherwise-executable) to avoid the extra query on
  // every page view.
  const itpApproved = itp.status === "approved" || itp.status === "client_accepted";
  const holdOpen =
    !draft && canExecute && itpApproved && project.enforce_hold_blocks_start ? !(await canCompleteInspection(itpItem.id)) : false;

  // Named "who's holding this" instead of the old generic "the assigned party must release it" —
  // found live: nobody could tell from this message alone which specific party/person to go chase.
  // Re-derives which levels are blocking + which rows on this activity are still open, the same way
  // canCompleteInspection itself does internally (that helper only ever returns a boolean).
  // Notice period: warn (never block) when the activity's planned date is closer than its hold/witness notice requires.
  let noticeWarning: string | null = null;
  try {
    // Loop over the intervention codes this activity actually has (not a hardcoded "H").
    const { data: progressCodes } = await supabase
      .from("activity_signoff_progress")
      .select("intervention")
      .eq("itp_item_id", itpItem.id)
      .returns<{ intervention: string }[]>();
    const codes = [...new Set((progressCodes ?? []).map((r) => r.intervention))];
    const messages: string[] = [];
    for (const code of codes) {
      const check = await getNoticeCheck(supabase, itpItem.id, code);
      if ((check.status === "short_notice" || check.status === "overdue") && check.message && !messages.includes(check.message)) messages.push(check.message);
    }
    if (messages.length > 0) noticeWarning = messages.join(" ");
  } catch {
    // Best-effort — the warning is advisory.
  }

  let openHoldHolders: { partyName: string; partyType: string; levelCode: string }[] = [];
  if (holdOpen) {
    const { data: blockingLevels } = await supabase
      .from(INTERVENTION_LEVEL_TYPES_TABLE)
      .select("code")
      .eq("organization_id", project.organization_id)
      .eq("is_blocking", true)
      .returns<{ code: string }[]>();
    const blockingCodes = (blockingLevels ?? []).map((l) => l.code);

    if (blockingCodes.length > 0) {
      const { data: openRows } = await supabase
        .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
        .select("intervention, project_parties(name, party_type)")
        .eq("itp_item_id", itpItem.id)
        .in("intervention", blockingCodes)
        .neq("status", "signed_off")
        .returns<{ intervention: string; project_parties: { name: string; party_type: string } | null }[]>();

      openHoldHolders = (openRows ?? [])
        .filter((r) => r.project_parties)
        .map((r) => ({
          partyName: r.project_parties!.name,
          partyType: PARTY_TYPE_LABEL[r.project_parties!.party_type] ?? r.project_parties!.party_type,
          levelCode: r.intervention,
        }));
    }
  }

  const locationPresetNames =
    !draft && canExecute && itpApproved && !holdOpen
      ? (await getLocationPresetsForProject(supabase, project.organization_id, project.id)).map((p) => p.name)
      : [];

  // For the "Not started yet, your organisation doesn't hold a role here" message: names whichever
  // party actually executes this specific activity (a subcontractor/main contractor — or client, if
  // this project opted them in — holding SOME intervention here), instead of leaving it generic.
  const executingPartyNames = [
    ...new Map(
      (stakeholderParties ?? [])
        .filter((row) => row.project_parties?.is_active && EXECUTING_PARTY_TYPES.has(row.project_parties.party_type))
        .map((row) => [
          row.project_parties!.id,
          { partyName: row.project_parties!.name, partyType: PARTY_TYPE_LABEL[row.project_parties!.party_type] ?? row.project_parties!.party_type },
        ])
    ).values(),
  ];

  const RESULT_TONE: Record<string, "success" | "danger" | "warning"> = { pass: "success", fail: "danger", partial: "warning" };

  return (
    <div className="max-w-3xl">
      <RealtimeRefresh table="checklist_responses" />
      {/* Was linking to the full ITP page — most people reach this checklist FROM the ITP's
          Checklists list, so "back" now returns there instead of the much heavier ITP detail page. */}
      <Link href={`/inspect/itps/${itp.id}/checklists`} className="text-sm text-burgundy hover:underline">
        ← Back to {itp.itp_number} checklists
      </Link>
      <p className="mt-2 text-sm text-muted">
        {project.organizations?.name} · {project.name} ·{" "}
        <Link href={`/inspect/itps/${itp.id}`} className="hover:underline">
          {itp.itp_number}
        </Link>
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-ink">
          Checklist <span className="doc-id text-lg text-muted">{template.checklist_number}</span>
        </h1>
        {templateVersion !== null && <Badge tone="info">Version {templateVersion}</Badge>}
        {archived && <Badge tone="warning">Archived</Badge>}
        <PageGuide
          title="Checklist — how this works"
          points={[
            "Only JAGS staff, or the subcontractor/main contractor party actually performing the work, can start or answer this checklist — an independent verifier (TPI/lab) holding a sign-off point, or the client, is sign-off-only unless the project has opted the client into execution.",
            "A still-open blocking intervention level (e.g. Hold) on this activity stops the inspection from even starting, once the project has \"Hold blocks start\" enforcement on.",
            "Register-fed verification (calibration, personnel certification) is a soft-stop assist shown inline while answering — it flags a mismatch, it doesn't block submission.",
            "Everyone with project access can view the checklist and its past results; only the executing party's answers are actually recorded (read-only for anyone else, including sign-off-only parties).",
            "Editing the checklist template itself (adding items) is collapsed under \"Edit checklist template\" and is staff-only.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-ink">
        {itpItem.item_number}. {itpItem.activity}
      </p>

      {archived && (
        <p className="mt-4 rounded-md border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-ink" role="status">
          This checklist is archived: new inspections cannot be started from it and it is hidden from the start-work and checklist lists.
          {session.isJagsStaff ? " Restore it under \"Edit checklist template\" to use it again." : ""}
        </p>
      )}

      {!draft && canExecute && !archived && holdOpen && (
        <p className="mt-6 rounded-md bg-off-white p-4 text-sm text-muted">
          This activity has an open <Badge tone="danger">Hold</Badge> — held by{" "}
          {openHoldHolders.length > 0 ? (
            openHoldHolders.map((h, i) => (
              <span key={i}>
                {i > 0 && ", "}
                <span className="font-medium text-ink">{h.partyName}</span> ({h.partyType}, {h.levelCode})
              </span>
            ))
          ) : (
            "a party on the intervention grid"
          )}
          . They must release it on the{" "}
          <Link href={`/inspect/itps/${itp.id}`} className="text-burgundy hover:underline">ITP page</Link>{" "}
          before the inspection can start.
        </p>
      )}

      {!draft && canExecute && !archived && !itpApproved && (
        <p className="mt-6 rounded-md bg-off-white p-4 text-sm text-muted">
          This ITP hasn&apos;t been approved yet, so site inspections can&apos;t start. Work opens once it is approved on the{" "}
          <Link href={`/inspect/itps/${itp.id}`} className="text-burgundy hover:underline">ITP page</Link>.
        </p>
      )}

      {!draft && canExecute && !archived && itpApproved && !holdOpen && (
        <div className="mt-6">
          {noticeWarning && (
            <p className="mb-3 rounded-md border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-ink" role="status">
              {noticeWarning}
            </p>
          )}
          <StartInspectionForm
            templateId={template.id}
            itpItemId={itpItem.id}
            projectId={project.id}
            projectName={project.name}
            itpNumber={itp.itp_number}
            activity={itpItem.activity}
            locationPresets={locationPresetNames}
          />
        </div>
      )}

      {!draft && !canExecute && !archived && (
        <p className="mt-6 rounded-md bg-off-white p-4 text-sm text-muted">
          {isSignoffOnlyParty ? (
            "Not started yet. You hold an independent sign-off point on this activity (see the intervention grid on the ITP page) — the contractor performing the work fills in this checklist, and you'll be notified to sign off once it's ready."
          ) : executingPartyNames.length > 0 ? (
            <>
              Not started yet. This is{" "}
              {executingPartyNames.map((p, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <span className="font-medium text-ink">{p.partyName}</span>&apos;s ({p.partyType}) activity to run
                </span>
              ))}{" "}
              — {ownPartyLink ? "your organisation isn't assigned to it" : "a JAGS inspector can also run it"}.
            </>
          ) : ownPartyLink ? (
            "Not started yet. Your organisation doesn't hold a sign-off point on this specific activity, so a JAGS inspector or the party assigned to it will run this field inspection."
          ) : (
            "Not started yet — a JAGS inspector or the party assigned to this activity will run this field inspection."
          )}
        </p>
      )}

      {draft && !canExecute && (
        <p className="mt-6 rounded-md border border-info/40 bg-info/10 p-4 text-sm text-info">
          {isSignoffOnlyParty
            ? "This inspection is in progress. You hold an independent sign-off point on this activity, not the field-entry role — the responses below are read-only for you; you'll be notified to sign off once it's complete."
            : ownPartyLink
              ? "This inspection is in progress. Your organisation doesn't hold a role on this specific activity, so the responses below are read-only — a JAGS inspector or the assigned party is running it."
              : "This inspection is in progress, run by a JAGS inspector or the party assigned to this activity — the responses below are read-only for your login."}
        </p>
      )}

      {draft && (
        <div className="mt-6 space-y-6">
          <ChecklistExecutionPanel
            templateId={template.id}
            inspectionRecordId={draft.id}
            items={(items ?? []).map((i) => ({
              id: i.id,
              item_number: i.item_number,
              description: i.description,
              is_mandatory: i.is_mandatory,
            }))}
            initialResponses={responseByItem}
            readOnly={!canExecute}
            registerVerification={registerVerification}
            personnelCertVerification={personnelCertVerification}
            calibrationOptions={calibrationOptions}
            materialOptions={materialOptions}
            welderOptions={welderOptions}
            canExecute={canExecute}
            projectId={project.id}
            itpItemId={itpItem.id}
            itemPhotos={itemPhotos}
            itemDocuments={itemDocuments}
            vaultOptions={vaultDocumentOptions}
            vaultFolders={vaultFolderOptions}
            hasNcr={hasNcr}
            photoSlot={
              <div id="photo-evidence-section" className="rounded-lg border border-border bg-surface p-4">
                <h2 className="text-sm font-medium text-ink">
                  Photo evidence <span className="text-danger">*</span>
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  At least one photo or linked document (here or on an individual item above) is required to complete this inspection.
                </p>
                <div className="mt-3">
                  <PhotoUpload projectId={project.id} inspectionRecordId={draft.id} photos={photos} readOnly={!canExecute} />
                </div>
                <div className="mt-4 border-t border-border pt-3">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted">From Document Vault</h3>
                  <div className="mt-2">
                    <InspectionEvidenceDocuments
                      inspectionRecordId={draft.id}
                      documents={evidenceDocuments}
                      vaultDocuments={vaultDocumentOptions}
                      projectId={project.id}
                      vaultFolders={vaultFolderOptions}
                      canEdit={canExecute}
                    />
                  </div>
                </div>
              </div>
            }
            hasEvidencePhoto={hasEvidencePhoto}
            completeSlot={
              <>
                <ConsistencyCheck templateId={template.id} inspectionRecordId={draft.id} />
                <CompleteInspectionForm templateId={template.id} inspectionRecordId={draft.id} />
              </>
            }
            missingPhotoSlot={
              <EvidenceMissingNotice
                templateId={template.id}
                inspectionRecordId={draft.id}
                consistencySlot={<ConsistencyCheck templateId={template.id} inspectionRecordId={draft.id} />}
              />
            }
            incompleteSlot={
              <p className="rounded-md bg-off-white p-4 text-sm text-muted">
                Answer every item above (Yes / No / N-A) to complete this inspection.
              </p>
            }
          />
        </div>
      )}

      {session.isJagsStaff && (
        // Round-table finding: template-editing controls (drag handle, +Add item) used to sit
        // directly under the field-answering view, in the default line of sight of an inspector who
        // just wants to fill in the checklist. Collapsed behind a <details> disclosure, closed by
        // default, so answering and editing read as two distinct modes rather than one crowded page.
        <details className="mt-8 rounded-lg border border-border bg-surface">
          <summary className="cursor-pointer select-none px-4 py-3 font-medium text-ink">
            Edit checklist template{templateVersion !== null ? ` (version ${templateVersion})` : ""}
          </summary>
          <TemplateItemsEditor
            templateId={template.id}
            items={(items ?? []).map((i) => ({ id: i.id, item_number: i.item_number, description: i.description, is_mandatory: i.is_mandatory }))}
            blockedReason={editBlockReason}
          />
          <p className="border-t border-border px-4 py-2 text-xs text-muted">
            &quot;Optional&quot; only drops the red asterisk on the field-answering view — every item still has to be
            answered, and a &quot;No&quot; still fails the whole inspection, the same as a mandatory item.
          </p>
          <AddChecklistItemForm templateId={template.id} disabledReason={editBlockReason} />
          <TemplateLifecycleControls
            templateId={template.id}
            archived={archived}
            deleteBlockedReason={templateDeleteBlockReason(recordCount)}
            duplicateTargets={duplicateTargets}
            backHref={`/inspect/itps/${itp.id}/checklists`}
          />
        </details>
      )}

      {(pastRecords ?? []).length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-ink">Past inspections</h2>
          <ul className="mt-2 space-y-1">
            {(pastRecords ?? []).map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <Link href={`/inspect/inspections/${r.id}`} className="doc-id text-burgundy hover:underline">
                  {r.record_number}
                </Link>
                <Badge tone={RESULT_TONE[r.overall_result ?? ""] ?? "neutral"}>{r.overall_result}</Badge>
                <span className="text-muted">{r.inspection_date}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
