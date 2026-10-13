import type { SupabaseClient } from "@supabase/supabase-js";
import { NUMBERING_CONFIGS_TABLE, type NumberingConfigRow, type NumberingDocType } from "@/lib/numbering/types";
import { formatDocumentNumber } from "@/lib/numbering/format";

/**
 * Read-only previews of the number a new ITP / NCR / IRN will get. They never advance a counter
 * (generateDocumentNumber / nextSequenceNumber do that on save), so the preview is only a hint:
 * another user saving first, or a number already in use, can make the real one differ.
 */

async function currentCounter(
  supabase: SupabaseClient,
  organizationId: string,
  projectId: string,
  docType: string
): Promise<number> {
  const { data } = await supabase
    .from("document_sequences")
    .select("current_number")
    .eq("organization_id", organizationId)
    .eq("project_id", projectId)
    .eq("doc_type", docType)
    .maybeSingle<{ current_number: number }>();
  return data?.current_number ?? 0;
}

/** The next ITP or NCR number, using the same configuration lookup and format as generateDocumentNumber. */
export async function previewNextDocumentNumber(
  supabase: SupabaseClient,
  { projectId, docType }: { projectId: string; docType: Extract<NumberingDocType, "itp" | "ncr"> }
): Promise<string | null> {
  const { data: project } = await supabase
    .from("projects")
    .select("organization_id, project_number")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string; project_number: string }>();
  if (!project) return null;

  const [{ data: projectConfigs }, { data: orgConfigs }] = await Promise.all([
    supabase
      .from(NUMBERING_CONFIGS_TABLE)
      .select("*")
      .eq("organization_id", project.organization_id)
      .eq("doc_type", docType)
      .eq("project_id", projectId)
      .returns<NumberingConfigRow[]>(),
    supabase
      .from(NUMBERING_CONFIGS_TABLE)
      .select("*")
      .eq("organization_id", project.organization_id)
      .eq("doc_type", docType)
      .is("project_id", null)
      .returns<NumberingConfigRow[]>(),
  ]);
  const config = projectConfigs?.[0] ?? orgConfigs?.[0] ?? null;
  const current = await currentCounter(supabase, project.organization_id, projectId, docType);
  return formatDocumentNumber(
    {
      clientCode: config?.client_code ?? project.project_number,
      originatorCode: config?.originator_code ?? "JAGS",
      docType,
      seq: current + 1,
    },
    {
      separator: config?.separator ?? "-",
      sequencePadding: config?.sequence_padding ?? 3,
      includeYear: config?.include_year ?? false,
      includeDiscipline: false,
    }
  );
}

/** The next IRN number for an inspection record: "<itp number>-IRN-<n>", counted per ITP. */
export async function previewNextIrnNumber(supabase: SupabaseClient, inspectionRecordId: string): Promise<string | null> {
  const { data: record } = await supabase
    .from("inspection_records")
    .select("itp_number, project_id, projects(organization_id)")
    .eq("id", inspectionRecordId)
    .maybeSingle<{ itp_number: string; project_id: string; projects: { organization_id: string } | null }>();
  if (!record?.projects) return null;
  const current = await currentCounter(supabase, record.projects.organization_id, record.project_id, `irn:${record.itp_number}`);
  return `${record.itp_number}-IRN-${current + 1}`;
}
