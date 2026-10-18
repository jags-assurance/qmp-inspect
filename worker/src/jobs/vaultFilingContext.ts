import type { SupabaseClient } from "@supabase/supabase-js";
import { attemptLetterFor, buildFilingPath, earlierFailedAttempts, type AttemptRecord } from "./vaultFiling";

type AttemptRow = AttemptRecord & { record_number: string };

export interface InspectionFilingContext {
  filingPath: string;
  attempt: string;
  attempts: AttemptRow[];
}

/** Everything the filing path / attempt letter of an inspection record needs. A missing discipline or
 *  project label degrades the label (e.g. "Unassigned discipline"); it never blocks filing. */
export async function resolveInspectionFilingContext(
  supabase: SupabaseClient,
  record: { id: string; project_id: string; itp_item_id: string | null; itp_number: string; activity: string; record_number: string }
): Promise<InspectionFilingContext> {
  let attempts: AttemptRow[] = [{ id: record.id, created_at: "", overall_result: null, record_number: record.record_number }];
  let discipline: { code: string; name: string } | null = null;
  let itemNumber: string | null = null;

  if (record.itp_item_id) {
    const { data: rows, error } = await supabase
      .from("inspection_records")
      .select("id, created_at, overall_result, record_number")
      .eq("itp_item_id", record.itp_item_id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(500)
      .returns<AttemptRow[]>();
    if (error) throw new Error(`Could not read inspection attempts: ${error.message}`);
    if (rows && rows.length > 0) attempts = rows;

    const { data: item } = await supabase
      .from("itp_items")
      .select("item_number, discipline_id")
      .eq("id", record.itp_item_id)
      .maybeSingle<{ item_number: string | null; discipline_id: string | null }>();
    itemNumber = item?.item_number ?? null;
    if (item?.discipline_id) {
      const { data: d } = await supabase
        .from("master_disciplines")
        .select("code, name")
        .eq("id", item.discipline_id)
        .maybeSingle<{ code: string; name: string }>();
      discipline = d ?? null;
    }
  }

  const { data: project } = await supabase
    .from("projects")
    .select("project_number, name")
    .eq("id", record.project_id)
    .maybeSingle<{ project_number: string | null; name: string | null }>();
  const projectLabel = [project?.project_number, project?.name].filter(Boolean).join(" · ");

  return {
    filingPath: buildFilingPath({ projectLabel, discipline, itpNumber: record.itp_number, itemNumber, activity: record.activity }),
    attempt: attemptLetterFor(attempts, record.id),
    attempts,
  };
}

/**
 * A later attempt passed: the filed reports of the activity's EARLIER FAILED attempts stay in the vault
 * (never deleted) but are marked superseded, pointing at the passing report. Same mechanism as
 * vaultAutoFile's revision supersede (status 'superseded' + superseded_by; a worker/service-role write,
 * which the vault immutability guard permits for approved -> superseded). Best-effort: the passing
 * report is already filed, so a failure here is logged, not thrown.
 */
export async function supersedeFailedAttemptReports(
  supabase: SupabaseClient,
  params: { projectId: string; passingRecordId: string; passingStoragePath: string; attempts: AttemptRow[] }
): Promise<number> {
  try {
    const failed = earlierFailedAttempts(params.attempts, params.passingRecordId);
    const references = failed.map((r) => r.record_number).filter(Boolean);
    if (references.length === 0) return 0;
    const { data: folder } = await supabase
      .from("vault_folders" as never)
      .select("id")
      .eq("project_id", params.projectId)
      .eq("folder_key", "checklists_forms")
      .maybeSingle<{ id: string }>();
    if (!folder) return 0;
    const { data: passingDoc } = await supabase
      .from("vault_documents" as never)
      .select("id, status")
      .eq("folder_id", folder.id)
      .eq("storage_path", `generated-documents:${params.passingStoragePath}`)
      .maybeSingle<{ id: string; status: string }>();
    // Only an APPROVED passing report supersedes anything (a for-review copy is not yet the record).
    if (!passingDoc || passingDoc.status !== "approved") return 0;
    const { data: updated } = await supabase
      .from("vault_documents" as never)
      .update({ status: "superseded", superseded_by: passingDoc.id } as never)
      .eq("folder_id", folder.id)
      .in("document_reference", references)
      .eq("status", "approved")
      .select("id");
    return updated?.length ?? 0;
  } catch (err) {
    console.warn("[vault] could not supersede failed-attempt reports:", err instanceof Error ? err.message : err);
    return 0;
  }
}
