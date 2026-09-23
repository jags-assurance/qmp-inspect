import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
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
import { isAiConfigured } from "@/lib/ai/gate";

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

  const { data: assignment } = await supabase
    .from("standalone_assignments" as any)
    .select("*, projects(id, name, organizations(name))")
    .eq("id", id)
    .maybeSingle<AssignmentDetail>();

  if (!assignment) notFound();

  const latestReportPdf = await getLatestFatReportPdf(id);

  const [
    { data: measurements },
    { data: photos },
    { data: rawEvidenceDocuments },
    { data: rawVaultDocuments },
    { data: punchItems },
    { data: signatures },
    { count: linkedOpenPunchCount },
  ] = await Promise.all([
      supabase
        .from("standalone_assignment_measurements" as any)
        .select("*")
        .eq("assignment_id", id)
        .order("sort_order")
        .returns<StandaloneAssignmentMeasurementRow[]>(),
      supabase
        .from("standalone_assignment_photos" as any)
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
        .select("id, title, document_reference, vault_folders!inner(project_id, name)")
        .eq("vault_folders.project_id", assignment.project_id)
        .order("title")
        .returns<{ id: string; title: string; document_reference: string | null; vault_folders: { name: string } | null }[]>(),
      supabase
        .from("standalone_assignment_punch_items" as any)
        .select("*")
        .eq("assignment_id", id)
        .order("created_at")
        .returns<StandaloneAssignmentPunchItemRow[]>(),
      supabase
        .from("standalone_assignment_signatures" as any)
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
      supabase
        .from("punch_list_items" as any)
        .select("id", { count: "exact", head: true })
        .eq("source_standalone_assignment_id", id)
        .eq("status", "open"),
    ]);

  return (
    <div>
      <RealtimeRefresh table="standalone_assignments" filter={`id=eq.${id}`} />
      <Link href="/inspect/standalone" className="text-sm text-burgundy hover:underline">
        ← Back to Standalone Assignments
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="doc-id text-2xl font-semibold text-ink">{assignment.assignment_number}</h1>
            <Badge tone={TYPE_TONE[assignment.assignment_type]}>{TYPE_LABEL[assignment.assignment_type]}</Badge>
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
            })
          )}
          punchItems={punchItems ?? []}
          signatures={signatures ?? []}
          linkedOpenPunchCount={linkedOpenPunchCount ?? 0}
          isJagsStaff={session.isJagsStaff}
        />
      </div>

      {session.isJagsStaff && (
        <div className="mt-6">
          <NarrativeEditor
            recordIdFieldName="assignment_id"
            recordId={assignment.id}
            projectId={assignment.project_id}
            aiConfigured={isAiConfigured()}
            initialNarrative={assignment.narrative}
            draftAction={draftFatNarrativeAction}
            saveAction={saveFatNarrativeAction}
          />
        </div>
      )}
    </div>
  );
}
