import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom } from "@/lib/supabase/untyped";
import { NCRS_TABLE, NCR_PHOTOS_TABLE, type NcrPhotoRow, type NcrSeverity, type NcrStatus } from "@/lib/ncrs/types";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { AUDIT_LOG_TABLE } from "@/lib/audit/types";
import { INSPECTION_RECORDS_TABLE } from "@/lib/checklists/db-types";
import { getLatestNcrPdf, getLatestNcrCloseoutCertificate } from "@/lib/reports/actions";
import { getSessionContext, isAdminStaff } from "@/lib/auth/session";
import { hasPermission } from "@/lib/rbac/permissions";
import { canEditAssignment, canEditCapa, canEditNcrDetails, canWithdrawNcr, canWorkNcr, evidenceCount } from "@/lib/ncrs/rules";
import { partyUserIds, projectPeople, userNames } from "@/lib/ncrs/recipients";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { DEFAULT_ROOT_CAUSE_CATEGORIES } from "@/lib/ncrs/extended";
import { getSignedPhotoUrls } from "@/lib/storage/signed-urls";

export interface NcrDetail {
  id: string;
  ncr_number: string;
  severity: NcrSeverity;
  description: string;
  requirement_not_met: string | null;
  status: NcrStatus;
  assigned_to: string | null;
  due_date: string | null;
  responsible_party_id: string | null;
  root_cause: string | null;
  corrective_action: string | null;
  preventive_action: string | null;
  verification_notes: string | null;
  closed_at: string | null;
  closed_by: string | null;
  raised_by: string | null;
  created_at: string;
  /** Last modification; drives the stale-PDF marker (S6-14). */
  updated_at?: string | null;
  project_id: string;
  inspection_record_id: string | null;
  /** Extended fields (null until the NCR hardening migration is applied / when not recorded). */
  location?: string | null;
  equipment_tag?: string | null;
  spec_reference?: string | null;
  root_cause_category?: string | null;
  disposition?: string | null;
  cost_impact?: number | null;
  schedule_impact_days?: number | null;
  contractor_response?: string | null;
  withdrawn_at?: string | null;
  withdrawn_reason?: string | null;
  duplicate_of_ncr_id?: string | null;
  reopen_count?: number | null;
  last_reopen_reason?: string | null;
  projects: { name: string; project_number: string; organizations: { name: string } | null } | null;
  itp_items: { item_number: string; activity: string } | null;
}

export interface NcrRelatedPunchItem {
  id: string;
  description: string;
  status: string;
  due_date: string | null;
  closing_evidence: string | null;
}
export interface NcrCategoryOption {
  code: string;
  label: string;
}
export interface NcrHistoryEntry {
  id: string;
  summary: string;
  created_at: string;
  actor_name: string | null;
}
export interface NcrInspectionSummary {
  id: string;
  record_number: string;
  activity: string;
  overall_result: string | null;
  inspection_date: string | null;
}
export interface NcrSiblingNcr {
  id: string;
  ncr_number: string;
  severity: NcrSeverity;
  status: NcrStatus;
}

/** Everything the NCR detail page / side panel renders — plain serializable data. */
export interface NcrDetailData {
  ncr: NcrDetail;
  latestNcrPdf: Awaited<ReturnType<typeof getLatestNcrPdf>>;
  latestCloseoutCertificate: Awaited<ReturnType<typeof getLatestNcrCloseoutCertificate>>;
  photos: (NcrPhotoRow & { signedUrl: string | null })[];
  people: { id: string; name: string }[];
  rootCauseCategories: NcrCategoryOption[];
  /** Raiser / staff, before verification: may correct description, location, tag, spec clause. */
  canEditDetails: boolean;
  canWithdraw: boolean;
  /** Assignee or CAPA author is the viewer: closing needs an admin override reason. */
  selfVerifyConflict: boolean;
  isAdmin: boolean;
  responsibleParties: { id: string; name: string; party_type: string }[];
  closeConsequences: string[];
  punchItems: NcrRelatedPunchItem[];
  history: NcrHistoryEntry[];
  inspectionRecord: NcrInspectionSummary | null;
  otherNcrs: NcrSiblingNcr[];
  /** JAGS staff: may verify, close and re-open. */
  canVerify: boolean;
  /** Admin staff or a close_ncr permission holder: may verify/close/re-open. */
  canClose: boolean;
  /** Raiser / assignee / responsible-party user / staff: may work the NCR. */
  canWork: boolean;
  /** Staff or raiser: may change assignee, due date and party. */
  canAssign: boolean;
  /** CAPA text is locked for this viewer (pending verification, non-staff). */
  capaLocked: boolean;
  /** Photos plus linked documents. */
  evidenceTotal: number;
  /** Names for the certificate-style summary. */
  closedByName: string | null;
  documents: { linkId: string; vaultDocumentId: string; title: string; documentReference: string | null; status: string }[];
  vaultOptions: { id: string; title: string; documentReference: string | null; folderName: string; revision: string | null; status: string; createdAt: string; storagePath: string | null }[];
}

/** Returns null when the NCR does not exist / is not visible. Callers handle auth. */
export async function loadNcrDetail(id: string): Promise<NcrDetailData | null> {
  const supabase = await createSupabaseServerClient();

  const baseCols =
    "id, ncr_number, severity, description, requirement_not_met, status, assigned_to, due_date, responsible_party_id, root_cause, corrective_action, preventive_action, verification_notes, closed_at, closed_by, raised_by, created_at, updated_at, project_id, inspection_record_id, projects(name, project_number, organization_id, organizations(name)), itp_items(item_number, activity)";
  const extendedCols =
    "location, equipment_tag, spec_reference, root_cause_category, disposition, cost_impact, schedule_impact_days, contractor_response, withdrawn_at, withdrawn_reason, duplicate_of_ncr_id, reopen_count, last_reopen_reason, capa_updated_by";
  type NcrWithOrg = NcrDetail & { projects: NcrDetail["projects"] & { organization_id: string }; capa_updated_by?: string | null };
  let { data: ncr, error: ncrError } = await supabase.from(NCRS_TABLE).select(`${baseCols}, ${extendedCols}`).eq("id", id).maybeSingle<NcrWithOrg>();
  if (ncrError && isMissingSchemaError(ncrError)) {
    // Extended-fields migration not applied yet: load the NCR without them.
    ({ data: ncr, error: ncrError } = await supabase.from(NCRS_TABLE).select(baseCols).eq("id", id).maybeSingle<NcrWithOrg>());
  }

  // A failed query (timeout, transient database error) must not look like a missing NCR.
  if (ncrError) throw new Error(`Could not load this NCR: ${ncrError.message}`);
  if (!ncr) return null;

  const [latestNcrPdf, latestCloseoutCertificate] = await Promise.all([
    getLatestNcrPdf(id),
    ncr.status === "closed" ? getLatestNcrCloseoutCertificate(id, ncr.closed_at) : Promise.resolve(null),
  ]);

  // Related context — each query is non-fatal: a failure just yields an empty list / null.
  const [punchItems, history, inspectionRecord, otherNcrs] = await Promise.all([
    (async (): Promise<NcrRelatedPunchItem[]> => {
      try {
        const { data } = await supabase
          .from(PUNCH_LIST_ITEMS_TABLE)
          .select("id, description, status, due_date, closing_evidence")
          .eq("source_ncr_id", id)
          .returns<NcrRelatedPunchItem[]>();
        return data ?? [];
      } catch {
        return [];
      }
    })(),
    (async (): Promise<NcrHistoryEntry[]> => {
      try {
        const { data } = await supabase
          .from(AUDIT_LOG_TABLE)
          .select("id, summary, created_at, actor_id")
          .eq("entity_type", "ncr")
          .eq("entity_id", id)
          .order("created_at", { ascending: false })
          .limit(200)
          .returns<{ id: string; summary: string; created_at: string; actor_id: string | null }[]>();
        // Names resolve through the directory helper: a non-staff viewer cannot read other users' rows.
        const names = await userNames(supabase, (data ?? []).map((e) => e.actor_id ?? ""));
        return (data ?? []).map((e) => ({
          id: e.id,
          summary: e.summary,
          created_at: e.created_at,
          actor_name: (e.actor_id && names.get(e.actor_id)) || null,
        }));
      } catch {
        return [];
      }
    })(),
    (async (): Promise<NcrInspectionSummary | null> => {
      if (!ncr.inspection_record_id) return null;
      try {
        const { data } = await supabase
          .from(INSPECTION_RECORDS_TABLE)
          .select("id, record_number, activity, overall_result, inspection_date")
          .eq("id", ncr.inspection_record_id)
          .maybeSingle<NcrInspectionSummary>();
        return data ?? null;
      } catch {
        return null;
      }
    })(),
    (async (): Promise<NcrSiblingNcr[]> => {
      try {
        const { data } = await supabase
          .from(NCRS_TABLE)
          .select("id, ncr_number, severity, status")
          .eq("project_id", ncr.project_id)
          .neq("id", id)
          .neq("status", "closed")
          .order("created_at", { ascending: false })
          .limit(5)
          .returns<NcrSiblingNcr[]>();
        return data ?? [];
      } catch {
        return [];
      }
    })(),
  ]);

  const [{ data: docRows }, { data: vaultRows }] = await Promise.all([
    untypedFrom(supabase, "ncr_documents")
      .select("id, vault_document_id, vault_documents(title, document_reference, status)")
      .eq("ncr_id", id)
      .returns<{ id: string; vault_document_id: string; vault_documents: { title: string; document_reference: string | null; status: string } | null }[]>(),
    ncr.status === "closed"
      ? Promise.resolve({ data: [] as never[] })
      : supabase
          .from("vault_documents")
          .select("id, title, document_reference, revision, status, created_at, storage_path, vault_folders!inner(project_id, name)")
          .eq("vault_folders.project_id", ncr.project_id)
          .eq("status", "approved")
          .order("title")
          .returns<{ id: string; title: string; document_reference: string | null; revision: string | null; status: string; created_at: string; storage_path: string | null; vault_folders: { name: string } | null }[]>(),
  ]);

  const { data: photos } = await supabase
    .from(NCR_PHOTOS_TABLE)
    .select("*")
    .eq("ncr_id", id)
    .order("created_at")
    .returns<NcrPhotoRow[]>();

  // Perf: one batched Storage call for every photo's signed URL instead of each <PhotoThumbnail>
  // fetching its own client-side (see lib/storage/signed-urls.ts's doc comment).
  const photoUrls = await getSignedPhotoUrls(supabase, "inspection-evidence", (photos ?? []).map((p) => p.storage_path));

  // Same "real people with access to this project" resolution as the raise-NCR form (see
  // app/inspect/ncrs/new/page.tsx) — access_grants (global/organization/project staff scopes) plus
  // project_parties rows linked to a login — just scoped to this NCR's one already-known project.
  const organizationId = ncr.projects?.organization_id ?? null;
  const [people, { data: responsibleParties }, categoryRows] = await Promise.all([
    // Through the directory helper: a non-staff raiser must still see the project's real people.
    projectPeople(supabase, ncr.project_id, organizationId),
    // R68: this NCR's project's own active parties, for the (optional) "responsible party" picker.
    supabase
      .from("project_parties")
      .select("id, name, party_type")
      .eq("project_id", ncr.project_id)
      .eq("is_active", true)
      .order("name")
      .returns<{ id: string; name: string; party_type: string }[]>(),
    (async (): Promise<NcrCategoryOption[]> => {
      try {
        const { data, error } = await supabase
          .from("ncr_root_cause_categories" as never)
          .select("code, label, organization_id, sort_order")
          .eq("is_active", true)
          .order("sort_order")
          .returns<{ code: string; label: string; organization_id: string | null; sort_order: number }[]>();
        if (error || !data || data.length === 0) return DEFAULT_ROOT_CAUSE_CATEGORIES;
        // Org rows override platform defaults with the same code.
        const byCode = new Map<string, NcrCategoryOption>();
        for (const r of data.filter((c) => c.organization_id === null)) byCode.set(r.code, { code: r.code, label: r.label });
        for (const r of data.filter((c) => c.organization_id !== null)) byCode.set(r.code, { code: r.code, label: r.label });
        return [...byCode.values()];
      } catch {
        return DEFAULT_ROOT_CAUSE_CATEGORIES;
      }
    })(),
  ]);
  const userById = new Map(people.map((p) => [p.id, { full_name: p.name, email: "" }]));

  // Real cascading effects of closing this NCR (see the CAPA form's own logic) — surfaced directly
  // near the close action now, not just documented in the collapsed PageGuide, since the guide text
  // itself calls this out as something people miss.
  const closeConsequences: string[] = ["Notifies the person who raised it", "Closes the punch-list item this NCR created when it was raised"];
  if (ncr.inspection_record_id) {
    closeConsequences.push("Notifies the original inspector the activity is ready to re-inspect");
  }

  const session = await getSessionContext();
  const isStaff = Boolean(session?.isJagsStaff);
  const partyUser = ncr.responsible_party_id
    ? ((await supabase.from("project_parties").select("user_id").eq("id", ncr.responsible_party_id).maybeSingle<{ user_id: string | null }>()).data?.user_id ?? null)
    : null;
  const partyMemberIds = await partyUserIds(supabase, ncr.responsible_party_id);
  const actor = {
    isStaff,
    userId: session?.userId ?? "",
    raisedBy: ncr.raised_by,
    assignedTo: ncr.assigned_to,
    partyUserId: partyUser,
    partyMemberIds,
  };
  const canClose = Boolean(session) && (isAdminStaff(session!) || (await hasPermission(session!.userId, "close_ncr", ncr.project_id)));
  const closedByName = ncr.closed_by ? ((await userNames(supabase, [ncr.closed_by])).get(ncr.closed_by) ?? null) : null;
  void userById;

  return {
    ncr,
    latestNcrPdf,
    latestCloseoutCertificate,
    photos: (photos ?? []).map((p) => ({ ...p, signedUrl: photoUrls.get(p.storage_path) ?? null })),
    people,
    rootCauseCategories: categoryRows,
    canEditDetails: Boolean(session) && canEditNcrDetails(ncr.status, isStaff, ncr.raised_by === session?.userId),
    canWithdraw: Boolean(session) && canWithdrawNcr(ncr.status, canClose, ncr.raised_by === session?.userId),
    selfVerifyConflict: Boolean(session) && (ncr.assigned_to === session?.userId || (!!ncr.capa_updated_by && ncr.capa_updated_by === session?.userId)),
    isAdmin: Boolean(session) && isAdminStaff(session!),
    responsibleParties: responsibleParties ?? [],
    closeConsequences,
    punchItems,
    history,
    inspectionRecord,
    otherNcrs,
    documents: (docRows ?? []).map((d) => ({
      linkId: d.id,
      vaultDocumentId: d.vault_document_id,
      title: d.vault_documents?.title ?? "Untitled document",
      documentReference: d.vault_documents?.document_reference ?? null,
      status: d.vault_documents?.status ?? "approved",
    })),
    vaultOptions: (vaultRows ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      documentReference: d.document_reference,
      folderName: d.vault_folders?.name ?? "Document Vault",
      revision: d.revision,
      status: d.status,
      createdAt: d.created_at,
      storagePath: d.storage_path,
    })),
    canVerify: isStaff,
    canClose,
    canWork: Boolean(session) && canWorkNcr(actor),
    canAssign: Boolean(session) && canEditAssignment(actor),
    capaLocked: !canEditCapa(ncr.status, isStaff, canClose),
    evidenceTotal: evidenceCount((photos ?? []).length, (docRows ?? []).length),
    closedByName,
  };
}
