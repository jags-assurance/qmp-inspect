// Deliberately NOT "use server": takes a live Supabase client (not serializable); call only from
// other server actions. Same pattern as lib/checklists/irn-notifications.ts. Best-effort, never throws.

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { createNotification } from "@/lib/notifications/helpers";
import { VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";
import { VAULT_DOCUMENT_APPROVERS_TABLE } from "@/lib/vault/approval-types";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface DocContext {
  title: string;
  documentNumber: string | null;
  uploadedBy: string | null;
  projectId: string;
  folderId: string;
  organizationId: string;
}

async function loadDoc(supabase: Supabase, documentId: string): Promise<DocContext | null> {
  const { data } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .select("title, document_number, uploaded_by, folder_id, vault_folders(project_id, projects(organization_id))")
    .eq("id", documentId)
    .maybeSingle<{
      title: string;
      document_number: string | null;
      uploaded_by: string | null;
      folder_id: string;
      vault_folders: { project_id: string; projects: { organization_id: string } | null } | null;
    }>();
  const organizationId = data?.vault_folders?.projects?.organization_id;
  if (!data || !organizationId) return null;
  return {
    title: data.title,
    documentNumber: data.document_number,
    uploadedBy: data.uploaded_by,
    projectId: data.vault_folders!.project_id,
    folderId: data.folder_id,
    organizationId,
  };
}

async function send(supabase: Supabase, ctx: DocContext, recipients: Set<string>, actorId: string | null, title: string, body: string) {
  const link = `/inspect/vault/${ctx.projectId}/${ctx.folderId}`;
  await Promise.all(
    [...recipients]
      .filter((uid) => uid !== actorId)
      .map((uid) =>
        createNotification(supabase, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          recipientUserId: uid,
          title,
          body,
          link,
        }).catch(() => undefined)
      )
  );
}

/** Document submitted for approval: tell its named approvers (if any are configured yet). */
export async function notifyDocumentSubmitted(supabase: Supabase, documentId: string, actorId: string | null): Promise<void> {
  try {
    const ctx = await loadDoc(supabase, documentId);
    if (!ctx) return;
    const { data: approvers } = await supabase
      .from(VAULT_DOCUMENT_APPROVERS_TABLE)
      .select("approver_user_id")
      .eq("document_id", documentId)
      .returns<{ approver_user_id: string }[]>();
    const recipients = new Set((approvers ?? []).map((a) => a.approver_user_id));
    if (recipients.size === 0) return;
    await send(
      supabase,
      ctx,
      recipients,
      actorId,
      "Document awaiting your approval",
      `${ctx.documentNumber ? `${ctx.documentNumber} — ` : ""}${ctx.title} was submitted for approval.`
    );
  } catch {
    // Best-effort.
  }
}

/** Document approved or rejected: tell the uploader. */
export async function notifyDocumentDecision(
  supabase: Supabase,
  documentId: string,
  actorId: string | null,
  decision: "approved" | "rejected",
  reason?: string
): Promise<void> {
  try {
    const ctx = await loadDoc(supabase, documentId);
    if (!ctx?.uploadedBy) return;
    await send(
      supabase,
      ctx,
      new Set([ctx.uploadedBy]),
      actorId,
      decision === "approved" ? "Document approved" : "Document rejected",
      `${ctx.documentNumber ? `${ctx.documentNumber} — ` : ""}${ctx.title} was ${decision}.${reason ? ` Reason: ${reason}` : ""}`
    );
  } catch {
    // Best-effort.
  }
}
