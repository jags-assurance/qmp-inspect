import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { uploadVaultDocumentCore } from "@/lib/vault/actions";
import { VAULT_FOLDERS_TABLE } from "@/lib/vault/types";
import {
  normalizeInboundPayload,
  parseProjectIdFromAddress,
  parseFolderKeyFromSubject,
  titleFromAttachmentFilename,
} from "@/lib/vault/email-inbound-parsing";

/**
 * R20b — email-to-vault ingestion.
 *
 * ============================================================================================
 * WHAT'S REAL HERE vs. WHAT NEEDS EXTERNAL CONFIGURATION
 * ============================================================================================
 * This route itself is real, working code: payload parsing (lib/vault/email-inbound-parsing.ts,
 * unit-tested directly — see its __tests__), address/subject routing, and the actual vault write
 * (storage upload + vault_documents insert + numbering + revision supersession, via the exact same
 * uploadVaultDocumentCore this app's own upload form uses) all run for real.
 *
 * What is NOT tested here, because it does not exist in this sandbox: an actual inbound-email
 * -receiving service (Postmark/SendGrid/Mailgun etc.) that would POST real mail traffic at this
 * URL. Nothing in this repo's env holds such a provider's credentials, and there is no DNS/MX
 * record pointed at one. Going live needs exactly these provider-side steps (the "small, obvious
 * configuration step" — no code change required here):
 *   1. Pick an inbound-email provider and add an MX record (or a provider-specific inbound
 *      subdomain, e.g. Postmark's Inbound Parse) for the address(es) mail should land on, e.g.
 *      vault@inbound.yourdomain.com.
 *   2. Point that provider's inbound webhook at:
 *        POST https://<this-app>/api/vault/email-inbound
 *      with the shared secret configured below as a header (Postmark supports custom webhook
 *      headers under Servers -> Inbound -> Webhook; a provider that can't set custom headers can
 *      instead append the secret as a query string, e.g. ?secret=..., which this handler also
 *      accepts).
 *   3. Set VAULT_EMAIL_WEBHOOK_SECRET in this app's env to a long random value, and configure that
 *      exact value on the provider's side.
 *   4. Set SUPABASE_SERVICE_ROLE_KEY (already a documented-but-previously-unused env var — see
 *      lib/supabase/service.ts) so this handler can write on behalf of a project without a user
 *      session.
 *
 * ============================================================================================
 * PAYLOAD SHAPE TARGETED
 * ============================================================================================
 * Postmark's Inbound Parse webhook (https://postmarkapp.com/manual#inbound), chosen as the
 * concrete target because its JSON shape is representative of most inbound-parse providers
 * (SendGrid's is close enough that normalizeInboundPayload's lowercase fallback already covers a
 * generic {to, from, subject, attachments} shape too). Only the fields this route actually needs
 * are read; every other Postmark field (TextBody, Headers, MessageID, ...) is ignored.
 *
 *   {
 *     "From": "site.engineer@contractor.example",
 *     "To": "vault+<project-uuid>@inbound.yourdomain.com",
 *     "Subject": "[drawings] Rev 3 structural steel GA",
 *     "Attachments": [
 *       { "Name": "GA-Rev3.pdf", "Content": "<base64>", "ContentType": "application/pdf", "ContentLength": 123456 }
 *     ]
 *   }
 *
 * ============================================================================================
 * ROUTING SCHEME — see lib/vault/email-inbound-parsing.ts for the parsing itself
 * ============================================================================================
 * - Which PROJECT: a `vault+<project_id>@...` plus-addressing token in the To address (the
 *   project's real UUID, not a human-friendly slug — it must be unambiguous with no session to
 *   disambiguate "which project did they mean" the way an in-app picker would).
 * - Which FOLDER: an optional `[folder_key]` token at the start of the Subject line, falling back
 *   to the always-present "general_reference" folder when the subject carries no recognised token.
 *
 * ============================================================================================
 * AUTH BOUNDARY
 * ============================================================================================
 * No user session exists for a third-party webhook call, so this route can't rely on RLS the way
 * every other write path in this app does (see lib/supabase/service.ts's own comment) — there is
 * no other unauthenticated route in this app to mirror (app/api/offline-sync and
 * app/api/itps/export both require a real session cookie). Its ONLY line of defence is the
 * shared-secret check below: a request without the correct secret is rejected before anything
 * else runs, full stop, and a deployment that never configures the secret rejects every request.
 */
export const runtime = "nodejs";

function checkSharedSecret(request: Request): boolean {
  const configured = process.env.VAULT_EMAIL_WEBHOOK_SECRET;
  if (!configured) return false;

  const headerSecret = request.headers.get("x-vault-webhook-secret");
  const authHeader = request.headers.get("authorization");
  const bearerSecret = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;
  const querySecret = new URL(request.url).searchParams.get("secret");

  const provided = headerSecret || bearerSecret || querySecret;
  return provided === configured;
}

export async function POST(request: Request) {
  if (!checkSharedSecret(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  if (!isServiceRoleConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Email-to-vault ingestion is not configured (SUPABASE_SERVICE_ROLE_KEY missing)." },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  const payload = normalizeInboundPayload(body);
  if (!payload) {
    return NextResponse.json(
      { ok: false, error: "Payload must include a 'To' address and an 'Attachments' array." },
      { status: 400 }
    );
  }

  const projectId = parseProjectIdFromAddress(payload.to);
  if (!projectId) {
    return NextResponse.json(
      { ok: false, error: `Could not find a project token (vault+<project-id>@...) in the To address: "${payload.to}".` },
      { status: 400 }
    );
  }

  if (payload.attachments.length === 0) {
    return NextResponse.json({ ok: true, message: "No attachments to ingest.", results: [] });
  }

  const folderKey = parseFolderKeyFromSubject(payload.subject);
  const supabase = createSupabaseServiceRoleClient();

  const { data: folder } = await supabase
    .from(VAULT_FOLDERS_TABLE)
    .select("id")
    .eq("project_id", projectId)
    .eq("folder_key", folderKey)
    .maybeSingle<{ id: string }>();

  if (!folder) {
    return NextResponse.json(
      { ok: false, error: `No "${folderKey}" folder found for project ${projectId}.` },
      { status: 404 }
    );
  }

  const results: { filename: string; ok: boolean; error?: string; documentNumber?: string }[] = [];

  for (const attachment of payload.attachments) {
    try {
      const bytes = Buffer.from(attachment.contentBase64, "base64");
      const safeName = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `vault/${projectId}/${folderKey}/email-${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("inspection-evidence")
        .upload(storagePath, bytes, { contentType: attachment.contentType ?? undefined });

      if (uploadError) {
        results.push({ filename: attachment.filename, ok: false, error: uploadError.message });
        continue;
      }

      const result = await uploadVaultDocumentCore(supabase, {
        folderId: folder.id,
        projectId,
        title: titleFromAttachmentFilename(attachment.filename),
        documentReference: "",
        revision: "0",
        documentDate: "",
        notes: `Received by email from ${payload.from || "an unknown sender"}${payload.subject ? ` — subject: "${payload.subject}"` : ""}.`,
        storagePath,
        fileSize: String(bytes.byteLength),
        uploadedBy: null,
      });

      if (result.error) {
        results.push({ filename: attachment.filename, ok: false, error: result.error });
      } else {
        results.push({ filename: attachment.filename, ok: true, documentNumber: result.documentNumber });
      }
    } catch (err) {
      results.push({
        filename: attachment.filename,
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error processing attachment.",
      });
    }
  }

  const anyOk = results.some((r) => r.ok);
  return NextResponse.json(
    { ok: anyOk, project_id: projectId, folder_key: folderKey, results },
    { status: anyOk ? 200 : 422 }
  );
}
