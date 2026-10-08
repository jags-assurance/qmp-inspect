import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom } from "@/lib/supabase/untyped";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { hasPermission } from "@/lib/rbac/permissions";
import { canRunStandaloneAssignment } from "@/lib/standalone/actions";
import { Badge } from "@/components/ui/badge";
import type {
  AssignmentConclusion,
  AssignmentStatus,
  AssignmentType,
  StandaloneAssignmentMeasurementRow,
  StandaloneAssignmentPhotoRow,
  StandaloneAssignmentPunchItemRow,
  StandaloneAssignmentSignatureRow,
  StandaloneAssignmentEvidenceDocumentRow,
} from "@/lib/standalone/actions";
import { STANDALONE_ASSIGNMENT_EVIDENCE_DOCUMENTS } from "@/lib/standalone/types";
import { AssignmentWorkspace } from "./assignment-workspace";
import type { VaultDocumentOption } from "./assignment-evidence-documents";
import { VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";
import { getLatestFatReportPdf, draftFatNarrativeAction, saveFatNarrativeAction } from "@/lib/reports/actions";
import { FatReportPdfButton } from "./fat-report-pdf-button";
import { NarrativeEditor } from "@/components/domain/narrative-editor";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { isAiEnabledForProject } from "@/lib/ai/gate";
import { getSignedPhotoUrls } from "@/lib/storage/signed-urls";
import { PageGuide } from "@/components/domain/page-guide";

interface AssignmentDetail {
  id: string;
  project_id: string;
  assignment_number: string;
  assignment_type: AssignmentType;
  equipment_description: string;
  manufacturer: string | null;
  model: string | null;
  serial_tag: string | null;
  location: string | null;
  standard_reference: string | null;
  assignment_date: string | null;
  status: AssignmentStatus;
  conclusion: AssignmentConclusion | null;
  notes: string | null;
  narrative: string | null;
  projects: { id: string; name: string; organizations: { name: string } | null } | null;
}

const TYPE_LABEL: Record<AssignmentType, string> = {
  fat: "FAT",
  witness_inspection: "Witness Inspection",
  specific_test: "Specific Test",
  pre_shipment: "Pre-Shipment",
};

const TYPE_TONE: Record<AssignmentType, "gold" | "info" | "neutral" | "warning"> = {
  fat: "gold",
  witness_inspection: "info",
  specific_test: "neutral",
  pre_shipment: "warning",
};

export default async function StandaloneAssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: assignment } = await untypedFrom(supabase, "standalone_assignments")
    .select("*, projects(id, name, organizations(name))")
    .eq("id", id)
    .maybeSingle<AssignmentDetail>();

  if (!assignment) notFound();

  // Same 3-way rule as requireStandaloneAccess (lib/standalone/actions.ts) — reused directly
  // rather than re-derived here, so this can never drift from the actual server-side gate.
  const canManage = await canRunStandaloneAssignment(session, supabase, assignment.project_id);

  const isAdmin = isAdminStaff(session);
  const canClose = isAdmin || (await hasPermission(session.userId, "close_punch_item", assignment.project_id));

  const latestReportPdf = await getLatestFatReportPdf(id);

  const { data: vaultFolderRows } = await supabase
    .from("vault_folders")
    .select("id, folder_key, name")
    .eq("project_id", assignment.project_id)
    .order("name")
    .returns<{ id: string; folder_key: string; name: string }[]>();

  const [
    { data: measurements },
    { data: photos },
    { data: rawEvidenceDocuments },
    { data: rawVaultDocuments },
    { data: punchItems },
    { data: signatures },
    { count: linkedOpenPunchCount },
    { count: linkedTotalPunchCount },
  ] = await Promise.all([
      untypedFrom(supabase, "standalone_assignment_measurements")
        .select("*")
        .eq("assignment_id", id)
        .order("sort_order")
        .returns<StandaloneAssignmentMeasurementRow[]>(),
      untypedFrom(supabase, "standalone_assignment_photos")
        .select("*")
        .eq("assignment_id", id)
        .order("created_at")
        .returns<StandaloneAssignmentPhotoRow[]>(),
      supabase
        .from(STANDALONE_ASSIGNMENT_EVIDENCE_DOCUMENTS)
        .select("id, assignment_id, vault_document_id, linked_by, created_at, vault_documents(title, document_reference)")
        .eq("assignment_id", id)
        .order("created_at")
        .returns<(StandaloneAssignmentEvidenceDocumentRow & { vault_documents: { title: string; document_reference: string | null } | null })[]>(),
      supabase
        .from(VAULT_DOCUMENTS_TABLE)
        .select("id, title, document_reference, revision, created_at, storage_path, vault_folders!inner(project_id, name)")
        .eq("vault_folders.project_id", assignment.project_id)
        .eq("status", "approved")
        .order("title")
        .returns<{ id: string; title: string; document_reference: string | null; revision: string | null; created_at: string; storage_path: string | null; vault_folders: { name: string } | null }[]>(),
      untypedFrom(supabase, "standalone_assignment_punch_items")
        .select("*")
        .eq("assignment_id", id)
        .order("created_at")
        .returns<StandaloneAssignmentPunchItemRow[]>(),
      untypedFrom(supabase, "standalone_assignment_signatures")
        .select("*")
        .eq("assignment_id", id)
        .order("signed_at")
        .returns<StandaloneAssignmentSignatureRow[]>(),
      // R16 clearance gate: the REAL blocker is the project-wide punch_list_items row(s) this
      // assignment's conditional-pass created (createPunchItemFromSource, source:
      // "fat_conditional_pass") — a separate table from standalone_assignment_punch_items (the
      // assignment's own internal punch tab). issueClearanceAction checks this same table server-
      // side; querying it here too so the UI's "ready to clear" hint can never say something the
      // server would actually reject.
      untypedFrom(supabase, "punch_list_items")
        .select("id", { count: "exact", head: true })
        .eq("source_standalone_assignment_id", id)
        .neq("status", "closed"),
      // Same linkage as linkedOpenPunchCount above, unfiltered by status — lets the clearance banner
      // read as a real "N of M closed" ratio instead of just the remaining-open count.
      untypedFrom(supabase, "punch_list_items")
        .select("id", { count: "exact", head: true })
        .eq("source_standalone_assignment_id", id),
    ]);

  // Real gap found in a wiring audit: the Photos tab only ever showed each photo's filename text —
  // never the actual image, unlike every other photo-evidence surface in the app (NCR detail,
  // inspection records). Same batched-signed-URL pattern as those: one Storage call for every photo
  // on this assignment, keyed by storage_path, so PhotoTile can render a real thumbnail.
  const photoSignedUrls = await getSignedPhotoUrls(
    supabase,
    "inspection-evidence",
    (photos ?? []).map((p) => p.storage_path)
  );

  return (
    <div>
      <RealtimeRefresh table="standalone_assignments" filter={`id=eq.${id}`} />
      <Link href="/inspect/standalone" className="text-sm text-burgundy hover:underline">
        ← Back to Standalone Assignments
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="doc-id text-2xl font-semibold text-ink">{assignment.assignment_number}</h1>
            <Badge tone={TYPE_TONE[assignment.assignment_type]}>{TYPE_LABEL[assignment.assignment_type]}</Badge>
            <PageGuide
              title="Standalone assignment — how this works"
              points={[
                "Executing this assignment — measurements, photos, punch items, signatures, finalizing, evidence linking — is JAGS-staff-only by default; a person specifically granted the run_standalone_assignment permission (Full Client-Managed tier only), or an active subcontractor/main-contractor party on a project a JAGS Admin has opted into contractor-run assignments, can do all of it themselves too.",
                "A \"conditional pass\" finalize creates a real project-wide punch-list item (not just the assignment's own internal punch tab) — the assignment stays \"conditional_open\" until every linked punch item is closed and clearance is explicitly issued.",
                "A clean pass or fail completes the assignment immediately on finalize — no separate clearance step.",
                "The FAT report PDF and narrative (AI-assisted draft, when AI is configured) are generated from this record's own data — the narrative editor only shows for JAGS staff.",
              ]}
            />
          </div>
          <p className="mt-1 text-lg text-ink">{assignment.equipment_description}</p>
          <p className="mt-1 text-sm text-muted">
            {assignment.projects?.organizations?.name} · {assignment.projects?.name}
            {assignment.standard_reference ? ` · ${assignment.standard_reference}` : ""}
          </p>
        </div>
        <FatReportPdfButton assignmentId={assignment.id} latest={latestReportPdf} />
      </div>

      <div className="mt-8">
        <AssignmentWorkspace
          assignment={assignment}
          measurements={measurements ?? []}
          photos={photos ?? []}
          photoSignedUrls={photoSignedUrls}
          evidenceDocuments={(rawEvidenceDocuments ?? []).map((d) => ({
            ...d,
            title: d.vault_documents?.title ?? "Untitled document",
            documentReference: d.vault_documents?.document_reference ?? null,
          }))}
          vaultDocuments={(rawVaultDocuments ?? []).map(
            (d): VaultDocumentOption => ({
              id: d.id,
              title: d.title,
              documentReference: d.document_reference,
              folderName: d.vault_folders?.name ?? "Document Vault",
              revision: d.revision,
              status: "approved",
              createdAt: d.created_at,
              storagePath: d.storage_path,
            })
          )}
          projectId={assignment.project_id}
          vaultFolders={(vaultFolderRows ?? []).map((f) => ({ id: f.id, key: f.folder_key, name: f.name }))}
          punchItems={punchItems ?? []}
          signatures={signatures ?? []}
          linkedOpenPunchCount={linkedOpenPunchCount ?? 0}
          linkedTotalPunchCount={linkedTotalPunchCount ?? 0}
          canManage={canManage}
          canClose={canClose}
          isAdmin={isAdmin}
        />
      </div>

      {session.isJagsStaff && canManage && (
        <div className="mt-6">
          <NarrativeEditor
            recordIdFieldName="assignment_id"
            recordId={assignment.id}
            projectId={assignment.project_id}
            aiConfigured={await isAiEnabledForProject(supabase, assignment.project_id)}
            initialNarrative={assignment.narrative}
            draftAction={draftFatNarrativeAction}
            saveAction={saveFatNarrativeAction}
          />
        </div>
      )}
    </div>
  );
}
