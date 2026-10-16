"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom, untypedRpc } from "@/lib/supabase/untyped";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { decisionNote, isOrphanCandidatePath, isOrphanDecision, isRemoveConfirmed, ORPHAN_BUCKET, type OrphanDecision } from "./logic";

export interface OrphanReviewState {
  error: string | null;
  success?: string | null;
}

const PATH = "/inspect/organisation/orphan-photos";

interface FlagRow {
  storage_path: string;
  organization_id: string;
  project_id: string;
  status: string;
}

async function loadFlag(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, storagePath: string): Promise<FlagRow | null> {
  const { data } = await untypedFrom(supabase, "orphan_photo_flags")
    .select("storage_path, organization_id, project_id, status")
    .eq("storage_path", storagePath)
    .maybeSingle<FlagRow>();
  return data ?? null;
}

/** Admin-only: Keep, or record "removed by hand" (no file is deleted by this path). */
export async function reviewOrphanPhotoAction(_prev: OrphanReviewState, formData: FormData): Promise<OrphanReviewState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can review orphaned photos." };

  const storagePath = String(formData.get("storage_path") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  const note = String(formData.get("note") ?? "");
  if (!storagePath || !isOrphanDecision(decision)) return { error: "Missing photo or decision." };

  const supabase = await createSupabaseServerClient();
  const flag = await loadFlag(supabase, storagePath);
  if (!flag) return { error: "That photo is not flagged." };
  if (flag.status !== "flagged") return { error: "That photo has already been reviewed." };

  const { error } = await untypedRpc(supabase, "review_orphan_photo", {
    p_storage_path: storagePath,
    p_decision: decision,
    p_note: decisionNote(decision, note, false),
  });
  if (error) return { error: "Could not record the decision. Check you have permission and try again." };

  await audit(supabase, flag, session.userId, decision === "kept" ? "orphan_photo_kept" : "orphan_photo_marked_removed", decision, false);
  revalidatePath(PATH);
  revalidatePath("/inspect/settings");
  return { error: null, success: decision === "kept" ? "Kept." : "Marked as removed." };
}

/**
 * Admin-only: deletes the stored object. Allowed ONLY when the row is still 'flagged', the path has the
 * expected <project>/<record>/<file> shape, nothing references the file any more, and the Admin typed the
 * confirmation. The decision is recorded and audited afterwards.
 */
export async function removeOrphanFileAction(_prev: OrphanReviewState, formData: FormData): Promise<OrphanReviewState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can remove a stored file." };

  const storagePath = String(formData.get("storage_path") ?? "").trim();
  const note = String(formData.get("note") ?? "");
  if (!storagePath || !isOrphanCandidatePath(storagePath)) return { error: "That is not a removable photo path." };
  if (!isRemoveConfirmed(String(formData.get("confirm") ?? ""))) return { error: "Type REMOVE FILE to confirm deleting the file." };

  const supabase = await createSupabaseServerClient();
  const flag = await loadFlag(supabase, storagePath);
  if (!flag) return { error: "That photo is not flagged, so it cannot be removed here." };
  if (flag.status !== "flagged") return { error: "That photo has already been reviewed." };

  // Re-check at the moment of deletion: if a photo or vault row now points at the file, it is no longer an orphan.
  const [{ count: photoRefs }, { count: vaultRefs }] = await Promise.all([
    untypedFrom(supabase, "inspection_photos").select("id", { count: "exact", head: true }).eq("storage_path", storagePath),
    untypedFrom(supabase, "vault_documents").select("id", { count: "exact", head: true }).eq("storage_path", storagePath),
  ]);
  if ((photoRefs ?? 0) > 0 || (vaultRefs ?? 0) > 0) {
    return { error: "This file is now referenced by a photo or document record, so it was not removed. Keep it instead." };
  }

  const { data: removed, error: removeError } = await supabase.storage.from(ORPHAN_BUCKET).remove([storagePath]);
  if (removeError || !removed || removed.length === 0) {
    return { error: "The file could not be deleted from storage (nothing was changed). Try again, or mark it as removed after deleting it by hand." };
  }

  const { error } = await untypedRpc(supabase, "review_orphan_photo", {
    p_storage_path: storagePath,
    p_decision: "removed",
    p_note: decisionNote("removed", note, true),
  });
  await audit(supabase, flag, session.userId, "orphan_photo_file_deleted", "removed", true);
  revalidatePath(PATH);
  revalidatePath("/inspect/settings");
  if (error) {
    return { error: "The file was deleted, but recording the decision failed. Use Mark removed to record it." };
  }
  return { error: null, success: "File deleted and recorded." };
}

async function audit(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  flag: FlagRow,
  actorId: string,
  action: string,
  decision: OrphanDecision,
  deleted: boolean
) {
  await recordAuditEvent(supabase, {
    organizationId: flag.organization_id,
    projectId: flag.project_id,
    entityType: "orphan_photo",
    entityId: flag.project_id,
    action,
    actorId,
    summary: deleted ? `Orphaned photo file deleted from storage: ${flag.storage_path}` : `Orphaned photo ${decision}: ${flag.storage_path}`,
    changes: { storage_path: flag.storage_path, decision, file_deleted: deleted },
  });
}
