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
  ITP_ITEMS_UNTYPED_TABLE,
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
  fetchRequiredRegisters,
  listCalibrationOptions,
  listMaterialOptions,
  listWelderOptions,
  pickRegisterKind,
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
import { ConfirmAiChecklist } from "./confirm-ai-checklist";
import { untypedFrom } from "@/lib/supabase/untyped";
import { projectPeople } from "@/lib/ncrs/recipients";
import { AssignActivityForm } from "./assign-activity-form";
import { templateReviewState } from "@/lib/checklists/ai-review-logic";
import { loadAssigneeOptions, viewerCanAssign } from "@/lib/checklists/assignment-queries";
import { getNoticeChecksForActivity } from "@/lib/signoff/notice-check";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { PhotoUpload } from "./photo-upload";
import { CompleteInspectionForm } from "./complete-inspection-form";
import { WaiveNoticeForm } from "./waive-notice-form";
import { CloneAnswersForm } from "./clone-answers-form";
import { loadNumericSpecsForTemplate, loadNumericValues } from "@/lib/checklists/numeric-spec-query";
import { unnotifiedNonBlockingLevels } from "@/lib/checklists/notice-waiver";
import { ConsistencyCheck } from "./consistency-check";
import { getExecutingPartyTypes } from "@/lib/checklists/execution-parties";
import { formatDistance, siteGeofenceFromProject, type SiteGeofence } from "@/lib/checklists/geofence";
import { getLocationPresetsForProject } from "@/lib/checklists/location-presets";
import { canCompleteInspection } from "@/lib/signoff/actions";
import { getSignedPhotoUrls } from "@/lib/storage/signed-urls";
import { PageGuide } from "@/components/domain/page-guide";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE } from "@/lib/signoff/db-types";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

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
  const tl = await getTranslator();
  const { templateId } = await params;
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: template, error: templateError } = await supabase
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

  // A failed query (timeout, transient database error) must not look like a missing page.
  if (templateError) throw new Error(`Could not load this checklist: ${templateError.message}`);
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
  // Perf: every read in this batch needs only the template row above (project.id, itpItem.id,
  // templateId) and the session — none consumes another's result — so they all start together
  // instead of as three batches in sequence on this page, the single most-visited one in the app
  // (every checklist fill hits it). The one dependent read, the viewer's party memberships, is
  // chained straight onto the stakeholder read whose party ids it needs.
  const [
    EXECUTING_PARTY_TYPES,
    { stakeholderParties, memberRows },
    { data: ownPartyLink },
    { data: items, error: itemsError },
    { data: draftRecords, error: draftError },
    { data: pastRecords },
    numericSpecs,
    { data: lifecycleRow, error: lifecycleError },
    { data: aiRow, error: aiError },
    { data: assignRow, error: assignError },
    canAssign,
  ] = await Promise.all([
    getExecutingPartyTypes(supabase, project.id),
    (async () => {
      const { data: stakeholderParties } = await supabase
        .from("activity_party_intervention")
        .select("project_parties(id, name, user_id, party_type, is_active)")
        .eq("itp_item_id", itpItem.id)
        .returns<{ project_parties: { id: string; name: string; user_id: string | null; party_type: string; is_active: boolean } | null }[]>();
      // Team members of a party (project_party_members) act for it too - the server gate already counts them.
      const stakeholderPartyIds = (stakeholderParties ?? []).map((r) => r.project_parties?.id).filter((v): v is string => !!v);
      if (stakeholderPartyIds.length === 0) return { stakeholderParties, memberRows: null };
      const { data: memberRows } = await supabase
        .from(PROJECT_PARTY_MEMBERS_TABLE)
        .select("project_party_id")
        .eq("user_id", session.userId)
        .in("project_party_id", stakeholderPartyIds)
        .returns<{ project_party_id: string }[]>();
      return { stakeholderParties, memberRows };
    })(),
    // Whether the viewer is linked to SOME project party at all — used to tell "you're a project
    // party, just not this activity's" apart from "you have no party link on this project," since the
    // former reads as a dead end otherwise (see the not-canExecute message below).
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
    loadNumericSpecsForTemplate(supabase, templateId),
    // Version / archive state. Read separately from the main template query so the page still works
    // before the versioning migration (20261106000100) is applied (error -> unversioned, active).
    supabase
      .from(CHECKLIST_TEMPLATES_TABLE)
      .select("version, archived_at")
      .eq("id", templateId)
      .maybeSingle<{ version: number | null; archived_at: string | null }>(),
    // AI review stage (20261114000102): absent columns (migration not applied) read as "not AI".
    supabase
      .from(CHECKLIST_TEMPLATES_TABLE)
      .select("ai_generated, ai_confirmed_at")
      .eq("id", templateId)
      .maybeSingle<{ ai_generated: boolean; ai_confirmed_at: string | null }>(),
    // Per-person assignment (20261114000101).
    supabase
      .from(ITP_ITEMS_UNTYPED_TABLE)
      .select("assigned_to_user_id")
      .eq("id", itpItem.id)
      .maybeSingle<{ assigned_to_user_id: string | null }>(),
    viewerCanAssign(supabase, { userId: session.userId, isStaff: session.isJagsStaff, itpItemId: itpItem.id, projectId: project.id }),
  ]);
  // is_active gates this the same way it now gates the server-side action (canExecuteItpItem
  // in lib/checklists/actions.ts) — a deactivated party shouldn't see live Yes/No/N-A buttons that the
  // server would reject anyway.
  const memberPartyIds = new Set((memberRows ?? []).map((m) => m.project_party_id));
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

  // A failed read must not render as "no items yet" or "no inspection in progress" (seen on dev under
  // load): the first hides the checklist, the second would offer Start inspection again.
  if (itemsError) throw new Error(`Could not load this checklist's items: ${itemsError.message}`);
  if (draftError) throw new Error(`Could not load this checklist's inspection in progress: ${draftError.message}`);
  const draft = draftRecords?.[0] ?? null;
  const templateVersion = lifecycleError ? null : (lifecycleRow?.version ?? null);
  const archived = lifecycleError ? false : !!lifecycleRow?.archived_at;
  const aiState = aiError || !aiRow ? "not_ai" : templateReviewState(aiRow);
  const aiDraft = aiState === "draft";
  const assignedToUserId = assignError ? null : (assignRow?.assigned_to_user_id ?? null);
  const showAssign = !assignError && canAssign;
  const showEditor = session.isJagsStaff;

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
  // Whether the "Start inspection" block can render at all (an open Hold aside, which loadHoldState
  // decides). The notice-period warning and the location presets are only shown inside it, so they
  // are only read then — the notice check used to run on every view, draft or not.
  const startFormPossible = !draft && canExecute && !archived && itpApproved && !aiDraft;

  // Everything the in-progress inspection shows: responses, photos with their signed URLs, linked and
  // pickable Vault documents, the NCR flag and the register-fed checks. Independent reads, so they
  // run together; the two dependent steps are chained onto the one read each needs.
  const loadDraftRows = (draftId: string) =>
    Promise.all([
      supabase
        .from(CHECKLIST_RESPONSES_TABLE)
        .select("checklist_item_id, result, comment, calibration_asset_id, material_id, welder_id, updated_at, no_ncr_reason")
        .eq("inspection_record_id", draftId)
        .returns<
          (Pick<
            ChecklistResponseRow,
            "checklist_item_id" | "result" | "comment" | "calibration_asset_id" | "material_id" | "welder_id"
          > & { updated_at: string; no_ncr_reason: string | null })[]
        >(),
      // Perf: one batched Storage call for every photo's signed URL on this checklist (across both
      // the whole-inspection section and every item's own photos) instead of each <PhotoThumbnail>
      // fetching its own client-side (see lib/storage/signed-urls.ts's doc comment).
      (async () => {
        const { data: photoRows } = await supabase
          .from(INSPECTION_PHOTOS_TABLE)
          .select("id, storage_path, caption, checklist_item_id")
          .eq("inspection_record_id", draftId)
          .returns<Pick<InspectionPhotoRow, "id" | "storage_path" | "caption" | "checklist_item_id">[]>();
        const photoUrls = await getSignedPhotoUrls(
          supabase,
          "inspection-evidence",
          (photoRows ?? []).map((p) => p.storage_path)
        );
        return { photoRows, photoUrls };
      })(),
      supabase
        .from(INSPECTION_EVIDENCE_DOCUMENTS_TABLE)
        .select("id, vault_document_id, checklist_item_id, vault_documents(title, document_reference, status)")
        .eq("inspection_record_id", draftId)
        .returns<{ id: string; vault_document_id: string; checklist_item_id: string | null; vault_documents: { title: string; document_reference: string | null; status: string } | null }[]>(),
      supabase
        .from(VAULT_DOCUMENTS_TABLE)
        .select("id, title, document_reference, revision, status, created_at, storage_path, vault_folders!inner(project_id, name)")
        .eq("vault_folders.project_id", project.id)
        .in("status", ["approved", "for_review", "rejected"])
        .order("title")
        .returns<{ id: string; title: string; document_reference: string | null; revision: string | null; status: string; created_at: string; storage_path: string | null; vault_folders: { name: string } | null }[]>(),
      supabase.from("ncrs").select("id", { count: "exact", head: true }).eq("inspection_record_id", draftId),
      supabase
        .from("vault_folders")
        .select("id, folder_key, name")
        .eq("project_id", project.id)
        .order("name")
        .returns<{ id: string; folder_key: string; name: string }[]>(),
      // R92-R100: register-fed auto-verification — a soft-stop assist, not a hard block. Computed
      // once per checklist (the same itp_items row backs every checklist_items row here), then shown
      // inline on every response row below. The activity's required_registers is read once for both
      // checks (each used to read it itself), and since it and the activity text alone decide the
      // register kind (pickRegisterKind, the kind checkRegisterVerification reports), that kind's
      // picker options load alongside the checks instead of after them.
      (async () => {
        const requiredRegisters = await fetchRequiredRegisters(supabase, itpItem.id);
        const registerKind = pickRegisterKind(itpItem.reference_spec, itpItem.acceptance_criteria, requiredRegisters);
        return Promise.all([
          checkRegisterVerification(supabase, {
            projectId: project.id,
            itpItemReferenceSpec: itpItem.reference_spec,
            itpItemAcceptanceCriteria: itpItem.acceptance_criteria,
            requiredRegisters,
          }),
          checkPersonnelCertification(supabase, {
            projectId: project.id,
            executingProjectPartyId,
            executingUserId: session.userId,
            itpItemReferenceSpec: itpItem.reference_spec,
            itpItemAcceptanceCriteria: itpItem.acceptance_criteria,
            requiredRegisters,
          }),
          registerKind === "calibration" ? listCalibrationOptions(supabase, project.id) : Promise.resolve([]),
          registerKind === "material" ? listMaterialOptions(supabase, project.id) : Promise.resolve([]),
          registerKind === "welder" ? listWelderOptions(supabase, project.id) : Promise.resolve([]),
        ]);
      })(),
    ]);

  const loadHoldState = async () => {
    const holdOpen =
      !draft && canExecute && itpApproved && project.enforce_hold_blocks_start ? !(await canCompleteInspection(itpItem.id)) : false;

    // Named "who's holding this" instead of the old generic "the assigned party must release it" —
    // found live: nobody could tell from this message alone which specific party/person to go chase.
    // Re-derives which levels are blocking + which rows on this activity are still open, the same way
    // canCompleteInspection itself does internally (that helper only ever returns a boolean).
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
    return { holdOpen, openHoldHolders };
  };

  // Notice period: warn (never block) when the activity's planned date is closer than its hold/witness notice requires.
  const loadNoticeWarning = async (): Promise<string | null> => {
    try {
      // Every intervention code this activity actually has (not a hardcoded "H"), checked in one batch.
      const checks = await getNoticeChecksForActivity(supabase, {
        itpItemId: itpItem.id,
        projectId: project.id,
        organizationId: project.organization_id,
      });
      const messages: string[] = [];
      for (const check of checks) {
        if ((check.status === "short_notice" || check.status === "overdue") && check.message && !messages.includes(check.message)) messages.push(check.message);
      }
      return messages.length > 0 ? messages.join(" ") : null;
    } catch {
      // Best-effort — the warning is advisory.
      return null;
    }
  };

  // S4-17: site geofence (start form) and the soft warning stored on the draft. Best-effort: the
  // columns exist only after migration 20261110000200, so errors just mean "not configured".
  const loadGeofence = async () => {
    let siteGeofence: SiteGeofence | null = null;
    let draftGeofenceWarning: string | null = null;
    if ((!draft && canExecute && itpApproved) || draft) {
      // The project's site and the draft's own reading don't depend on each other, so read both at once.
      const [{ data: siteRow }, { data: geo }] = await Promise.all([
        supabase
          .from("projects")
          .select("site_latitude, site_longitude, site_radius_m")
          .eq("id", project.id)
          .maybeSingle<{ site_latitude: number | null; site_longitude: number | null; site_radius_m: number | null }>(),
        draft
          ? supabase
              .from(INSPECTION_RECORDS_TABLE)
              .select("location_geofence_status, location_distance_m, location_accuracy_m")
              .eq("id", draft.id)
              .maybeSingle<{ location_geofence_status: string | null; location_distance_m: number | null; location_accuracy_m: number | null }>()
          : Promise.resolve({ data: null }),
      ]);
      siteGeofence = siteRow ? siteGeofenceFromProject(siteRow) : null;
      if (geo?.location_geofence_status === "outside" && siteGeofence) {
        draftGeofenceWarning = `Started about ${formatDistance(Number(geo.location_distance_m ?? 0))} from the project site (limit ${formatDistance(siteGeofence.radiusM)}).`;
      }
    }
    return { siteGeofence, draftGeofenceWarning };
  };

  // "Who fixes this?" for items answered No: who is named, and (for people who can execute) who can
  // be picked - everyone with access to the project. Best-effort: a failure just hides the feature.
  const loadFixAssignments = async () => {
    const fixAssignments = new Map<string, { id: string; name: string }>();
    let fixOptions: { id: string; name: string }[] = [];
    if (!draft) return { fixAssignments, fixOptions };
    try {
      const { data: fixRows } = await untypedFrom(supabase, "checklist_responses")
        .select("checklist_item_id, fix_assigned_to")
        .eq("inspection_record_id", draft.id)
        .not("fix_assigned_to", "is", null)
        .returns<{ checklist_item_id: string; fix_assigned_to: string }[]>();
      const people = canExecute || (fixRows ?? []).length > 0 ? await projectPeople(supabase, project.id, project.organization_id) : [];
      const nameById = new Map(people.map((p) => [p.id, p.name]));
      for (const r of fixRows ?? []) fixAssignments.set(r.checklist_item_id, { id: r.fix_assigned_to, name: nameById.get(r.fix_assigned_to) ?? "a team member" });
      if (canExecute) fixOptions = people;
    } catch {
      // Column not migrated yet or lookup failed: the item simply shows no assignment.
    }
    return { fixAssignments, fixOptions };
  };

  // Perf: the second and last batch. Everything left needs only the first batch's results (the draft,
  // the viewer's rights, the template's state) and nothing from within this batch, so it all runs
  // together instead of the ~15 sequential steps it used to take.
  const [
    numericValues,
    unnotifiedWitness,
    assigneeOptions,
    [responseCount, recordCount, duplicateTargets],
    draftRows,
    { holdOpen, openHoldHolders },
    noticeWarning,
    { siteGeofence, draftGeofenceWarning },
    locationPresets,
    { fixAssignments, fixOptions },
  ] = await Promise.all([
    draft ? loadNumericValues(supabase, draft.id) : Promise.resolve(new Map<string, number>()),
    draft && session.isJagsStaff ? unnotifiedNonBlockingLevels(supabase, itpItem.id, draft.id) : Promise.resolve([] as Awaited<ReturnType<typeof unnotifiedNonBlockingLevels>>),
    showAssign
      ? loadAssigneeOptions(supabase, { itpItemId: itpItem.id, projectId: project.id, organizationId: project.organization_id })
      : Promise.resolve([] as Awaited<ReturnType<typeof loadAssigneeOptions>>),
    showEditor
      ? Promise.all([
          countTemplateResponses(supabase, templateId),
          countTemplateRecords(supabase, templateId),
          archived ? Promise.resolve([]) : loadDuplicateTargets(supabase, project.id, itpItem.id),
        ])
      : Promise.resolve([0, 0, []] as [number, number, Awaited<ReturnType<typeof loadDuplicateTargets>> | never[]]),
    draft ? loadDraftRows(draft.id) : Promise.resolve(null),
    loadHoldState(),
    startFormPossible ? loadNoticeWarning() : Promise.resolve(null),
    loadGeofence(),
    // Shown only on the Start form, and not while a Hold is open (read alongside the Hold check).
    startFormPossible
      ? getLocationPresetsForProject(supabase, project.organization_id, project.id)
      : Promise.resolve([] as Awaited<ReturnType<typeof getLocationPresetsForProject>>),
    loadFixAssignments(),
  ]);
  const editBlockReason = itemEditBlockReason({ archived, responseCount });
  const assignedName = assigneeOptions.find((o) => o.id === assignedToUserId)?.name ?? null;
  const locationPresetNames = holdOpen ? [] : locationPresets.map((p) => p.name);

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

  if (draftRows) {
    const [
      { data: responses },
      { photoRows, photoUrls },
      { data: evidenceDocRows },
      { data: rawVaultDocuments },
      { count: ncrCount },
      { data: rawVaultFolders },
      registerChecks,
    ] = draftRows;
    hasNcr = !!ncrCount;
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

    [registerVerification, personnelCertVerification, calibrationOptions, materialOptions, welderOptions] = registerChecks;
  }

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
      {/* Scoped to the draft's own answers: unfiltered, every answer saved on ANY checklist re-ran
          this whole page (layout included) for every viewer who had one open. The app only ever
          upserts answers (a filtered subscription gets no DELETE events), so the filter loses no
          event that changes this view. */}
      <RealtimeRefresh table="checklist_responses" filter={draft ? `inspection_record_id=eq.${draft.id}` : undefined} />
      {/* Was linking to the full ITP page — most people reach this checklist FROM the ITP's
          Checklists list, so "back" now returns there instead of the much heavier ITP detail page. */}
      <Link href={`/inspect/itps/${itp.id}/checklists`} className="text-sm text-burgundy hover:underline">
        <T>← Back to</T> {itp.itp_number} <T>checklists</T>
      </Link>
      <p className="mt-2 text-sm text-muted">
        {project.organizations?.name} · {project.name} ·{" "}
        <Link href={`/inspect/itps/${itp.id}`} className="hover:underline">
          {itp.itp_number}
        </Link>
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-ink">
          <T>Checklist</T> <span className="doc-id text-lg text-muted">{template.checklist_number}</span>
        </h1>
        {templateVersion !== null && <Badge tone="info"><T>Version</T> {templateVersion}</Badge>}
        {archived && <Badge tone="warning"><T>Archived</T></Badge>}
        <PageGuide
          title={tl("Checklist — how this works")}
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
          <T>This checklist is archived: no new inspections can start.</T>
          {session.isJagsStaff ? " Restore it under \"Edit checklist template\" to use it again." : ""}
        </p>
      )}

      {aiDraft && <ConfirmAiChecklist templateId={template.id} canConfirm={session.isJagsStaff} />}
      {aiState === "confirmed" && (
        <p className="mt-2 text-xs text-muted"><T>AI-generated checklist, reviewed and confirmed by JAGS staff.</T></p>
      )}

      {assignedToUserId && (
        <p className="mt-2 text-sm text-ink">
          <T>Assigned to</T> {assignedToUserId === session.userId ? "you" : (assignedName ?? "a team member")}
        </p>
      )}
      {showAssign && !archived && (
        <details className="mt-3 rounded-md border border-border bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink"><T>Assign to a person</T></summary>
          <AssignActivityForm itpItemId={itpItem.id} templateId={template.id} currentAssigneeId={assignedToUserId} options={assigneeOptions} />
        </details>
      )}

      {!draft && canExecute && !archived && holdOpen && (
        <p className="mt-6 rounded-md bg-off-white p-4 text-sm text-muted">
          <T>This activity has an open</T> <Badge tone="danger"><T>Hold</T></Badge> <T>— held by</T>{" "}
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
          <T>. They must release it on the</T>{" "}
          <Link href={`/inspect/itps/${itp.id}`} className="text-burgundy hover:underline"><T>ITP page</T></Link>{" "}
          <T>before the inspection can start.</T>
        </p>
      )}

      {!draft && canExecute && !archived && !itpApproved && (
        <p className="mt-6 rounded-md bg-off-white p-4 text-sm text-muted">
          <T>This ITP is not approved yet, so inspections cannot start. Approve it on the</T>{" "}
          <Link href={`/inspect/itps/${itp.id}`} className="text-burgundy hover:underline"><T>ITP page</T></Link>.
        </p>
      )}

      {!draft && canExecute && !archived && itpApproved && !holdOpen && !aiDraft && (
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
            siteGeofence={siteGeofence}
          />
        </div>
      )}

      {!draft && !canExecute && !archived && (
        <p className="mt-6 rounded-md bg-off-white p-4 text-sm text-muted">
          {isSignoffOnlyParty ? (
            "Not started. You hold a sign-off point here; the contractor fills in this checklist and you will be told when to sign off."
          ) : executingPartyNames.length > 0 ? (
            <>
              <T>Not started yet. This is</T>{" "}
              {executingPartyNames.map((p, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <span className="font-medium text-ink">{p.partyName}</span>&apos;s ({p.partyType}<T>) activity to run</T>
                </span>
              ))}{" "}
              — {ownPartyLink ? "your organisation isn't assigned to it" : "a JAGS inspector can also run it"}.
            </>
          ) : ownPartyLink ? (
            "Not started. A JAGS inspector or the assigned party will run it."
          ) : (
            "Not started. A JAGS inspector or the assigned party will run it."
          )}
        </p>
      )}

      {draft && !canExecute && (
        <p className="mt-6 rounded-md border border-info/40 bg-info/10 p-4 text-sm text-info">
          {isSignoffOnlyParty
            ? "In progress. Answers are read-only for you; you will be told when to sign off."
            : ownPartyLink
              ? "In progress. Answers are read-only for you."
              : "In progress. Answers are read-only for you."}
        </p>
      )}

      {draft && draftGeofenceWarning && (
        <p className="mt-4 rounded-md border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-ink" role="status">
          {draftGeofenceWarning} <T>This is a warning only; it is recorded with the inspection.</T>
        </p>
      )}

      {draft && (
        <div className="mt-6 space-y-6">
          {canExecute && <CloneAnswersForm inspectionRecordId={draft.id} />}
          <ChecklistExecutionPanel
            templateId={template.id}
            inspectionRecordId={draft.id}
            items={(items ?? []).map((i) => ({
              id: i.id,
              item_number: i.item_number,
              description: i.description,
              is_mandatory: i.is_mandatory,
              numeric: numericSpecs.get(i.id) ?? null,
            }))}
            numericValues={numericValues}
            initialResponses={responseByItem}
            fixAssignments={fixAssignments}
            fixOptions={fixOptions}
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
                  <T>Photo evidence</T> <span className="text-danger">*</span>
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  <T>Add at least one photo or document, here or on an item, to complete.</T>
                </p>
                <div className="mt-3">
                  <PhotoUpload projectId={project.id} inspectionRecordId={draft.id} photos={photos} readOnly={!canExecute} />
                </div>
                <div className="mt-4 border-t border-border pt-3">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted"><T>From Document Vault</T></h3>
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
                {unnotifiedWitness.length > 0 && <WaiveNoticeForm inspectionRecordId={draft.id} labels={unnotifiedWitness} />}
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
                <T>Answer every item to complete.</T>
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
            <T>Edit checklist template</T>{templateVersion !== null ? ` (version ${templateVersion})` : ""}
          </summary>
          <TemplateItemsEditor
            templateId={template.id}
            items={(items ?? []).map((i) => ({ id: i.id, item_number: i.item_number, description: i.description, is_mandatory: i.is_mandatory }))}
            blockedReason={editBlockReason}
          />
          <p className="border-t border-border px-4 py-2 text-xs text-muted">
            <T>&quot;Optional&quot; only removes the red asterisk. Every item must still be answered.</T>
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
        <details className="mt-8" open={!draft}>
          <summary className="cursor-pointer text-sm font-medium text-ink"><T>Past inspections</T> ({(pastRecords ?? []).length})</summary>
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
        </details>
      )}
    </div>
  );
}
