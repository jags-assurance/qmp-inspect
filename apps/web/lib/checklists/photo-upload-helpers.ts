"use client";

// Shared compress -> upload-or-queue flow used by both the generic (whole-inspection) PhotoUpload
// section and the per-item ItemPhotoUpload affordance on each ResponseRow, so the two entry points
// don't reimplement the same compress/upload/offline-fallback logic. See photo-upload.tsx for the
// original single-purpose version this was extracted from.

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { saveInspectionPhotoAction } from "@/lib/checklists/actions";
import { enqueueOutboxItem } from "@/lib/offline/db";
import { notifyOutboxChanged } from "@/lib/offline/sync-client";
import { compressImageFile } from "@/lib/media/compress-image";

export interface UploadPhotoParams {
  projectId: string;
  inspectionRecordId: string;
  /** Links this photo to one specific checklist item/finding, or undefined for the generic
   *  whole-inspection evidence section (checklist_item_id stays null on the row). */
  checklistItemId?: string;
  file: File;
}

/** Builds the {project_id}/{inspection_record_id}/... storage path for a photo. The project id
 *  stays the first path segment either way, matching the inspection_evidence_* RLS policies
 *  (storage.foldername(name)[1]) — the item-linked variant just adds an extra `item-{id}` segment
 *  those policies don't inspect. */
function buildStoragePath(projectId: string, inspectionRecordId: string, checklistItemId: string | undefined, safeName: string): string {
  const prefix = checklistItemId
    ? `${projectId}/${inspectionRecordId}/item-${checklistItemId}`
    : `${projectId}/${inspectionRecordId}`;
  return `${prefix}/${Date.now()}-${safeName}`;
}

export class PhotoRejectedError extends Error {}

async function queueForOffline({ projectId, inspectionRecordId, checklistItemId, file }: UploadPhotoParams) {
  await enqueueOutboxItem({
    kind: "photo",
    fields: {
      project_id: projectId,
      inspection_record_id: inspectionRecordId,
      file_name: file.name,
      ...(checklistItemId ? { checklist_item_id: checklistItemId } : {}),
    },
    file,
    fileName: file.name,
  });
  notifyOutboxChanged();
}

/**
 * Compresses, then uploads straight to Supabase Storage from the browser (subject to the same RLS
 * as everything else) and records the resulting path as an inspection_photos row — falling back to
 * the offline outbox if there's no connection, or if the live attempt fails mid-flight (R60:
 * "nothing is lost offline"). Returns an object-URL preview when queued offline (no storage_path
 * yet), or null when it uploaded live (the caller should router.refresh() to pick up the new row).
 */
export async function uploadOrQueuePhoto(params: UploadPhotoParams): Promise<{ queuedPreviewUrl: string | null }> {
  const file = await compressImageFile(params.file);
  const next = { ...params, file };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await queueForOffline(next);
    return { queuedPreviewUrl: URL.createObjectURL(file) };
  }

  try {
    const supabase = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = buildStoragePath(params.projectId, params.inspectionRecordId, params.checklistItemId, safeName);

    const { error: uploadError } = await supabase.storage.from("inspection-evidence").upload(path, file);
    if (uploadError) throw uploadError;

    const saved = await saveInspectionPhotoAction({
      inspectionRecordId: params.inspectionRecordId,
      storagePath: path,
      checklistItemId: params.checklistItemId,
    });
    if (saved.error) {
      // Business rejection (completed/permission/size) is not a connectivity problem: don't queue.
      await supabase.storage.from("inspection-evidence").remove([path]);
      throw new PhotoRejectedError(saved.error);
    }

    return { queuedPreviewUrl: null };
  } catch (err) {
    if (err instanceof PhotoRejectedError) throw err;
    // Could be a genuine failure or a connection that dropped mid-upload — either way, don't lose
    // the photo: queue it the same as the offline path instead of just showing an error.
    await queueForOffline(next);
    return { queuedPreviewUrl: URL.createObjectURL(file) };
  }
}
