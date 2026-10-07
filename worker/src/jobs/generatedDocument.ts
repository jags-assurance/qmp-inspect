import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { autoFileVaultDocument, GENERATED_DOCUMENTS_BUCKET, uploadGeneratedFile } from "./vaultAutoFile";
import { stripGeneratedPrefix } from "./dataBookHelpers";

/**
 * Helpers shared by the record-document renderers (IRN, inspection report, NCR close-out, handover
 * certificate): regenerate-without-new-revision, who may file an APPROVED copy, and orphan cleanup.
 */

/** JSON.stringify with sorted object keys, so equal content always hashes equal. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/** SHA-256 hex of the SOURCE content of a document (not of the PDF bytes, which embed a timestamp). */
export function sourceHash(data: unknown): string {
  return createHash("sha256").update(stableStringify(data)).digest("hex");
}

/** Short tag of a source hash that is embedded in the generated file name, so an identical re-render can be found again. */
export function hashTag(hash: string): string {
  return hash.slice(0, 12);
}

/** Pulls the hash tag back out of a generated path (`...-h<12 hex>-<timestamp>.pdf`). */
export function tagFromPath(path: string): string | null {
  const m = /-h([0-9a-f]{12})-\d+\.pdf$/.exec(path);
  return m ? m[1] : null;
}

/**
 * The bare generated-documents path of an already-filed document with the SAME source content, if any
 * (approved or for-review, same folder + reference). Regenerating an unchanged document then returns the
 * existing file instead of minting an identical new controlled revision (rev 0, 1, 2 ... all the same).
 */
export async function findFiledByHash(
  supabase: SupabaseClient,
  projectId: string,
  folderKey: string,
  documentReference: string,
  tag: string
): Promise<string | null> {
  const { data: folder, error: folderError } = await supabase
    .from("vault_folders" as never)
    .select("id")
    .eq("project_id", projectId)
    .eq("folder_key", folderKey)
    .maybeSingle<{ id: string }>();
  if (folderError) throw new Error(`Could not resolve vault folder '${folderKey}': ${folderError.message}`);
  if (!folder) return null;
  const { data, error } = await supabase
    .from("vault_documents" as never)
    .select("storage_path, status")
    .eq("folder_id", folder.id)
    .eq("document_reference", documentReference)
    .in("status", ["approved", "for_review"])
    .like("storage_path", `%-h${tag}-%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<{ storage_path: string; status: string }[]>();
  if (error) throw new Error(`Could not look up an earlier identical copy: ${error.message}`);
  return data && data.length > 0 ? stripGeneratedPrefix(data[0].storage_path) : null;
}

/**
 * May this requester cause an APPROVED vault copy to be filed? JAGS staff, the system (auto-queued jobs)
 * and holders of one of `permissionKeys` (custom RBAC) or `approve_vault_document` may; anyone else's
 * render is filed `for_review`, so a subcontractor clicking "Generate" cannot bypass the vault approval
 * workflow. `allowUserIds` lets the document's own issuer through (an IRN issued by the executing party).
 */
export async function canFileApproved(
  supabase: SupabaseClient,
  requestedBy: string | null | undefined,
  projectId: string,
  opts: { permissionKeys?: string[]; allowUserIds?: (string | null | undefined)[] } = {}
): Promise<boolean> {
  if (!requestedBy || requestedBy === "system") return true;
  if (opts.allowUserIds?.includes(requestedBy)) return true;
  const { data: user, error } = await supabase
    .from("users")
    .select("is_jags_staff")
    .eq("id", requestedBy)
    .maybeSingle<{ is_jags_staff: boolean | null }>();
  if (error) throw new Error(`Could not verify requester ${requestedBy}: ${error.message}`);
  if (user?.is_jags_staff === true) return true;

  const keys = ["approve_vault_document", ...(opts.permissionKeys ?? [])];
  const { data: assignments, error: aErr } = await supabase
    .from("custom_role_assignments" as never)
    .select("role_id, project_id")
    .eq("user_id", requestedBy)
    .returns<{ role_id: string; project_id: string | null }[]>();
  if (aErr) throw new Error(`Could not read role assignments: ${aErr.message}`);
  const roleIds = (assignments ?? []).filter((a) => a.project_id === null || a.project_id === projectId).map((a) => a.role_id);
  if (roleIds.length === 0) return false;
  const { data: perms, error: pErr } = await supabase
    .from("custom_role_permissions" as never)
    .select("role_id")
    .in("role_id", roleIds)
    .in("permission_key", keys)
    .limit(1)
    .returns<{ role_id: string }[]>();
  if (pErr) throw new Error(`Could not read role permissions: ${pErr.message}`);
  return (perms ?? []).length > 0;
}

/** Best-effort removal of a generated object (cleanup after a failed filing). Never throws. */
export async function removeGeneratedFile(supabase: SupabaseClient, path: string): Promise<void> {
  try {
    await supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).remove([path]);
  } catch {
    // Best-effort.
  }
}

/**
 * Uploads a generated file and files it in the vault. If filing fails the uploaded object is removed
 * before the error propagates, so a retry (which renders to a NEW path) does not leave the earlier
 * object orphaned forever.
 */
export async function uploadAndFile(
  supabase: SupabaseClient,
  storagePath: string,
  body: Buffer | Uint8Array,
  fileParams: Parameters<typeof autoFileVaultDocument>[1]
): Promise<void> {
  await uploadGeneratedFile(supabase, storagePath, body);
  try {
    await autoFileVaultDocument(supabase, fileParams);
  } catch (err) {
    await removeGeneratedFile(supabase, storagePath);
    throw err;
  }
}
