import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CorrectionRequestStatus } from "./correction-request-logic";

export interface CorrectionRequestRow {
  id: string;
  inspection_record_id: string | null;
  signoff_progress_id: string | null;
  project_id: string;
  requested_by: string;
  reason: string;
  status: CorrectionRequestStatus;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
}

const COLS = "id, inspection_record_id, signoff_progress_id, project_id, requested_by, reason, status, resolution_note, resolved_at, created_at";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (c: Supabase) => (c as any).from("inspection_correction_requests");

/** Requests for one inspection record (RLS limits what the viewer sees). Empty on a database without the table. */
export async function listCorrectionRequestsForRecord(supabase: Supabase, recordId: string): Promise<CorrectionRequestRow[]> {
  const { data, error } = await table(supabase).select(COLS).eq("inspection_record_id", recordId).order("created_at", { ascending: false }).limit(50);
  return error ? [] : ((data ?? []) as CorrectionRequestRow[]);
}

/** Open requests for a project (staff activity panel). */
export async function listOpenCorrectionRequestsForProject(supabase: Supabase, projectId: string): Promise<CorrectionRequestRow[]> {
  const { data, error } = await table(supabase).select(COLS).eq("project_id", projectId).eq("status", "open").order("created_at", { ascending: false }).limit(50);
  return error ? [] : ((data ?? []) as CorrectionRequestRow[]);
}
