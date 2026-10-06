import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { INSPECTION_RECORDS_TABLE, CHECKLIST_ITEMS_TABLE } from "@/lib/checklists/db-types";

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/**
 * Same checks as saveInspectionPhotoAction, applied to a queued offline photo BEFORE it is uploaded:
 * the inspection exists (RLS-visible), belongs to the stated project, is not completed, the item
 * (if any) belongs to the inspection's checklist, and the file is an image of at most 25 MB.
 * Also returns the safe storage prefix: {project}/{record}/ with no "..".
 */
export async function validateOfflinePhoto(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    inspectionRecordId: string;
    checklistItemId: string | null;
    file: Blob;
  }
): Promise<{ error: string } | { error: null }> {
  const { projectId, inspectionRecordId, checklistItemId, file } = input;
  const ids = [projectId, inspectionRecordId, checklistItemId ?? ""];
  if (ids.some((v) => v.includes("..") || v.includes("/"))) return { error: "Invalid photo path." };

  if (file.size > MAX_PHOTO_BYTES) return { error: "Photo is too large (maximum 25 MB)." };
  if (!file.type || !file.type.startsWith("image/")) return { error: "Only image files can be attached as photo evidence." };

  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("project_id, overall_result, checklist_template_id")
    .eq("id", inspectionRecordId)
    .maybeSingle<{ project_id: string; overall_result: string | null; checklist_template_id: string | null }>();
  if (!record) return { error: "Inspection not found or you don't have permission to add photos to it." };
  if (record.project_id !== projectId) return { error: "That photo's project does not match this inspection." };
  if (record.overall_result) return { error: "This inspection is completed — photos can no longer be changed." };

  if (checklistItemId) {
    const { data: item } = await supabase
      .from(CHECKLIST_ITEMS_TABLE)
      .select("id")
      .eq("id", checklistItemId)
      .eq("template_id", record.checklist_template_id ?? "")
      .maybeSingle<{ id: string }>();
    if (!item) return { error: "That checklist item was not found on this inspection's checklist." };
  }
  return { error: null };
}
