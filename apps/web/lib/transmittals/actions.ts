"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { sendEmail } from "@/lib/notifications/email";
import { isUndeliverableAddress } from "@/lib/notifications/undeliverable";
import { untypedFrom } from "@/lib/supabase/untyped";
import { isMissingDbObject } from "@/lib/databook/db-errors";
import { VAULT_DOCUMENTS_TABLE, VAULT_FOLDERS_TABLE } from "@/lib/vault/types";
import { DATA_BOOKS_TABLE } from "@/lib/databook/types";
import { buildTransmittalDownloadBlock } from "./download";
import {
  TRANSMITTALS_TABLE,
  buildTransmittalSubject,
  canTransmit,
  injectDownloadBlock,
  renderTransmittalEmailHtml,
  transmittalLinkPath,
  validateTransmittalInput,
  type TransmittalEntityType,
} from "./logic";

export interface SendTransmittalState {
  error: string | null;
  success?: string | null;
}

interface Resolved {
  organizationId: string;
  label: string;
  kind: string;
  status: string;
}

/** Looks the entity up under the caller's own RLS and returns what the email needs to say about it. */
async function resolveEntity(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  entityType: TransmittalEntityType,
  entityId: string,
  projectId: string
): Promise<Resolved | null> {
  const { data: project } = await supabase
    .from("projects")
    .select("organization_id, project_number")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string; project_number: string }>();
  if (!project) return null;

  if (entityType === "vault_document") {
    const { data: doc } = await supabase
      .from(VAULT_DOCUMENTS_TABLE)
      .select("title, document_number, revision, status, folder_id")
      .eq("id", entityId)
      .maybeSingle()
      .returns<{ title: string; document_number: string | null; revision: string; status: string; folder_id: string } | null>();
    if (!doc) return null;
    const { data: folder } = await supabase
      .from(VAULT_FOLDERS_TABLE)
      .select("id")
      .eq("id", doc.folder_id)
      .eq("project_id", projectId)
      .maybeSingle()
      .returns<{ id: string } | null>();
    if (!folder) return null;
    const number = doc.document_number ? `${doc.document_number} — ` : "";
    return { organizationId: project.organization_id, label: `${number}${doc.title} (Rev ${doc.revision})`, kind: "document", status: doc.status };
  }

  const { data: book } = await supabase
    .from(DATA_BOOKS_TABLE)
    .select("book_number, title, status, revision")
    .eq("id", entityId)
    .eq("project_id", projectId)
    .maybeSingle()
    .returns<{ book_number: string; title: string; status: string; revision: number | string | null } | null>();
  if (!book) return null;
  return {
    organizationId: project.organization_id,
    label: `${book.book_number} — ${book.title}${book.revision !== null && book.revision !== undefined ? ` (Rev ${book.revision})` : ""}`,
    kind: "Data Book",
    status: book.status,
  };
}

/**
 * Staff-only: emails a link to an ISSUED document (approved vault document / issued Data Book) to up to
 * 10 recipients and logs one document_transmittals row per recipient.
 *
 * Delivery: the link is rendered into the email, the log rows are written under the caller's own RLS
 * (the policy re-checks the document belongs to the project and is issued), and an email_outbox row per
 * recipient is written with the service role. The first send attempt runs in after(); anything that
 * fails stays 'pending' in the outbox and is retried by the worker (worker/src/emailOutbox.ts).
 * The stored body_html holds only a placeholder for the download block. On every send attempt (here
 * and in the worker retry) a 7-day signed storage link and the verify-page link are generated with the
 * service role and substituted in, so external recipients can open the PDF without an account and a
 * retry days later never carries an expired link. The signed URL is never stored, logged or audited.
 */
export async function sendTransmittalAction(_prev: SendTransmittalState, formData: FormData): Promise<SendTransmittalState> {
  const entityTypeRaw = String(formData.get("entity_type") ?? "");
  const entityId = String(formData.get("entity_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  if ((entityTypeRaw !== "vault_document" && entityTypeRaw !== "data_book") || !entityId || !projectId) {
    return { error: "Missing document details. Refresh the page and try again." };
  }
  const entityType = entityTypeRaw as TransmittalEntityType;

  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can email a transmittal." };

  const input = validateTransmittalInput({
    recipientsText: String(formData.get("recipients") ?? ""),
    message: String(formData.get("message") ?? ""),
  });
  if (!input.ok) return { error: input.error };
  // Reserved/test domains (.demo, .test, example.com ...) can never receive mail: refuse now rather than
  // log a transmittal whose delivery is guaranteed to fail (the notification emailer skips them too).
  const undeliverable = input.recipients.filter((email) => isUndeliverableAddress(email));
  if (undeliverable.length > 0) {
    return { error: `${undeliverable.join(", ")} ${undeliverable.length === 1 ? "is a test or placeholder address that" : "are test or placeholder addresses that"} cannot receive email. Use a real address.` };
  }

  if (!process.env.RESEND_API_KEY || !isServiceRoleConfigured()) {
    return { error: "Email delivery is not configured on this server (RESEND_API_KEY and SUPABASE_SERVICE_ROLE_KEY are required)." };
  }

  const supabase = await createSupabaseServerClient();
  const entity = await resolveEntity(supabase, entityType, entityId, projectId);
  if (!entity) return { error: "Document not found, or you do not have access to it." };
  if (!canTransmit(entityType, entity.status)) {
    return { error: entityType === "vault_document" ? "Only an approved document can be sent. Approve it first." : "Only an issued Data Book can be sent." };
  }

  const linkPath = transmittalLinkPath(entityType, projectId, entityId);
  const subject = buildTransmittalSubject(entity.label);
  const batchId = randomUUID();
  const html = renderTransmittalEmailHtml({
    entityLabel: entity.label,
    entityKind: entity.kind,
    senderName: session.fullName || "A JAGS Assurance colleague",
    message: input.message,
    linkPath,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
  });

  // Log first (RLS-checked): a recipient is never emailed without a log row.
  const rows = input.recipients.map((email) => ({
    id: randomUUID(),
    batch_id: batchId,
    organization_id: entity.organizationId,
    project_id: projectId,
    entity_type: entityType,
    entity_id: entityId,
    entity_label: entity.label,
    link_path: linkPath,
    recipient_email: email,
    subject,
    message: input.message,
    sent_by: session.userId,
  }));
  const { error: logError } = await untypedFrom(supabase, TRANSMITTALS_TABLE).insert(rows);
  if (logError) {
    if (isMissingDbObject(logError)) return { error: "Transmittals need the latest database update (migration 20261112000102). Ask a JAGS Admin to apply it." };
    return { error: "Could not record the transmittal. Check you have access to this project and try again." };
  }

  const service = createSupabaseServiceRoleClient();
  const { error: outboxError } = await untypedFrom(service, "email_outbox").insert(
    rows.map((r) => ({
      transmittal_id: r.id,
      recipient_email: r.recipient_email,
      subject,
      body_html: html,
      // Short head start for the immediate send below; the worker only picks up what is still pending after it.
      next_attempt_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    }))
  );
  if (outboxError) {
    await untypedFrom(service, TRANSMITTALS_TABLE)
      .update({ status: "failed", last_error: "Could not queue the email." })
      .eq("batch_id", batchId);
    return { error: "The transmittal was logged but could not be queued for delivery. Check the log and try again." };
  }

  const sendAll = async () => {
    for (const r of rows) {
      try {
        const block = await buildTransmittalDownloadBlock(service, r.id, process.env.NEXT_PUBLIC_APP_URL ?? "");
        await sendEmail({ toEmail: r.recipient_email, subject, html: injectDownloadBlock(html, block) });
        const sentAt = new Date().toISOString();
        await untypedFrom(service, "email_outbox").update({ status: "sent", sent_at: sentAt, attempts: 1 }).eq("transmittal_id", r.id);
        await untypedFrom(service, TRANSMITTALS_TABLE).update({ status: "sent", sent_at: sentAt, last_error: null }).eq("id", r.id);
      } catch (err) {
        // Stays pending in the outbox: the worker retries it with backoff and updates the log row.
        const message = err instanceof Error ? err.message.slice(0, 500) : "Send failed";
        console.error(`[transmittal] first send failed for ${r.id}: ${message}`);
        await untypedFrom(service, "email_outbox").update({ attempts: 1, last_error: message }).eq("transmittal_id", r.id);
      }
    }
  };
  try {
    after(sendAll);
  } catch {
    await sendAll();
  }

  await recordAuditEvent(supabase, {
    organizationId: entity.organizationId,
    projectId,
    entityType: entityType === "vault_document" ? "vault_document" : "data_book",
    entityId,
    action: "transmitted",
    actorId: session.userId,
    summary: `${entity.kind === "Data Book" ? "Data Book" : "Document"} "${entity.label}" emailed to ${input.recipients.length} recipient${input.recipients.length === 1 ? "" : "s"}: ${input.recipients.join(", ")}`,
    changes: { recipients: input.recipients, batch_id: batchId },
  });

  revalidatePath(linkPath);
  const note = input.warnings.length > 0 ? ` ${input.warnings.join(" ")}` : "";
  return { error: null, success: `Sending to ${input.recipients.length} recipient${input.recipients.length === 1 ? "" : "s"}.${note}` };
}
