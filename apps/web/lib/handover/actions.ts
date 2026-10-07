"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { sendNotificationEmail } from "@/lib/notifications/email";
import { NOTIFICATIONS_TABLE } from "@/lib/notifications/types";
import { DATA_BOOKS_TABLE, HANDOVER_CERTIFICATES_TABLE } from "@/lib/databook/types";
import { computeDataBookReadiness, type DataBookReadiness } from "@/lib/databook/readiness";
import {
  MAX_ACK_NAME_LENGTH,
  MAX_CERT_NUMBER_LENGTH,
  failingReadinessCategories,
  isValidPackagePath,
  isValidSha256,
} from "@/lib/databook/helpers";
import { isMissingDbObject } from "@/lib/databook/db-errors";
import { buildOverrideItems } from "@/lib/databook/override-items";
import { GENERATED_DOCUMENTS_BUCKET } from "@/lib/reports/types";
import { acknowledgeErrorMessage, clientRecipientIds, issueErrorMessage } from "./helpers";
import { queueHandoverCertificatePdf, queueIssuedDataBookPdf } from "./certificate-pdf";

export interface IssueHandoverState {
  error: string | null;
  /** Issued, but a follow-up step needs attention (e.g. the Data Book PDF could not be queued). */
  notice?: string | null;
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface NotifyParams {
  organizationId: string;
  projectId: string;
  recipientIds: string[];
  title: string;
  body: string;
  link: string;
}

/** One notifications insert for all recipients (best-effort), then emails (awaited, failures ignored) when email is configured. */
async function notifyMany(supabase: ServerClient, p: NotifyParams): Promise<void> {
  if (p.recipientIds.length === 0) return;
  try {
    await supabase.from(NOTIFICATIONS_TABLE).insert(
      p.recipientIds.map((id) => ({
        organization_id: p.organizationId,
        project_id: p.projectId,
        recipient_user_id: id,
        title: p.title,
        body: p.body,
        link: p.link,
      }))
    );
    if (process.env.RESEND_API_KEY) {
      const { data: users } = await supabase.from("users").select("email").in("id", p.recipientIds).returns<{ email: string }[]>();
      // Awaited (not fire-and-forget): on serverless the function can be frozen once the response is sent,
      // which silently dropped unawaited sends.
      await Promise.allSettled(
        (users ?? [])
          .filter((u) => Boolean(u.email))
          .map((u) => sendNotificationEmail({ toEmail: u.email, title: p.title, body: p.body, link: p.link }))
      );
    }
  } catch {
    // Best-effort.
  }
}

/**
 * Removes a package file a failed issue left behind. Only ever a handover/<this book>/ path that no
 * certificate references, so the cleanup cannot touch an issued package. The service role is used when
 * configured because the user session has no delete rights on that bucket until the storage-policy
 * migration is applied (previously this was a silent no-op and every rejected issue left an orphan).
 */
async function removeOrphanPackage(supabase: ServerClient, dataBookId: string, path: string): Promise<void> {
  try {
    const { data: referenced } = await supabase
      .from(HANDOVER_CERTIFICATES_TABLE)
      .select("id")
      .eq("package_storage_path", path)
      .limit(1)
      .returns<{ id: string }[]>();
    if (referenced && referenced.length > 0) return;
    if (!isValidPackagePath(path, dataBookId)) return;
    const client = isServiceRoleConfigured() ? createSupabaseServiceRoleClient() : supabase;
    await client.storage.from(GENERATED_DOCUMENTS_BUCKET).remove([path]);
  } catch {
    // Best-effort cleanup.
  }
}

/**
 * Moves a compiled Data Book to 'issued' and creates its handover certificate through the atomic
 * issue_data_book_handover() RPC (claim + certificate insert in one transaction, with its own staff /
 * compiled / path-prefix / sha256 / object-exists / gate checks). Staff-only. Before calling it this
 * action re-runs the readiness gates server-side: a book can only be issued when the project is ready
 * now or the book carries a documented override (and a conditional handover needs a JAGS Admin).
 */
export async function issueHandoverAction(
  _prev: IssueHandoverState,
  formData: FormData
): Promise<IssueHandoverState> {
  const dataBookId = String(formData.get("data_book_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const certificateNumber = String(formData.get("certificate_number") ?? "").trim();
  const handoverNotes = String(formData.get("handover_notes") ?? "").trim();
  const packageStoragePath = String(formData.get("package_storage_path") ?? "").trim();
  const packageSha256 = String(formData.get("package_sha256") ?? "").trim().toLowerCase();

  const supabase = await createSupabaseServerClient();
  const pathOk = Boolean(dataBookId) && isValidPackagePath(packageStoragePath, dataBookId);

  // Removes the file the browser already uploaded when issuing fails, so failed attempts don't leave orphans.
  async function fail(error: string): Promise<IssueHandoverState> {
    if (pathOk) await removeOrphanPackage(supabase, dataBookId, packageStoragePath);
    return { error };
  }

  if (!dataBookId || !projectId) {
    return fail("Missing Data Book.");
  }
  if (certificateNumber.length > MAX_CERT_NUMBER_LENGTH) {
    return fail(`Certificate number must be ${MAX_CERT_NUMBER_LENGTH} characters or fewer.`);
  }
  if (handoverNotes.length > 2000) {
    return fail("Notes must be 2000 characters or fewer.");
  }

  // A certificate must never be issuable without an actual package file behind it.
  if (!packageStoragePath) {
    return { error: "Upload the handover package file before issuing this certificate." };
  }
  if (!pathOk) {
    return { error: "The uploaded package reference is invalid. Re-upload the file and try again." };
  }
  if (!isValidSha256(packageSha256)) {
    return fail("The package fingerprint is invalid. Re-upload the file and try again.");
  }

  const session = await requireSession();
  if (!session.isJagsStaff) {
    return fail("Only JAGS staff can issue a handover certificate.");
  }

  const { data: dataBook } = await supabase
    .from(DATA_BOOKS_TABLE)
    .select("id, project_id, book_number, status, override_open_punch_items, override_reason, override_items")
    .eq("id", dataBookId)
    .eq("project_id", projectId)
    .maybeSingle<{
      id: string;
      project_id: string;
      book_number: string;
      status: string;
      override_open_punch_items: boolean;
      override_reason: string | null;
      override_items: unknown;
    }>();

  if (!dataBook || dataBook.status !== "compiled") {
    return fail("Only a compiled Data Book can be issued for handover.");
  }

  // Server-side re-check of every readiness gate at issue time (something may have changed since compile).
  // Fails closed: a failed query must not read as "ready".
  let readiness: DataBookReadiness;
  try {
    readiness = await computeDataBookReadiness(projectId);
  } catch (err) {
    console.error("[handover] readiness failed during issue", err);
    return fail("Could not verify the Data Book readiness right now (a data query failed). Nothing was issued — try again.");
  }
  // Same rule as compile: not-ready OR project-not-completed needs a documented override on the book.
  const { data: projectRow } = await supabase
    .from("projects")
    .select("organization_id, status")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string; status: string }>();
  const needsOverride = !readiness.isReady || projectRow?.status !== "completed";
  if (needsOverride && !dataBook.override_open_punch_items) {
    const failing = failingReadinessCategories(readiness).map((c) => `${c.category} (${c.outstanding} outstanding)`);
    if (projectRow?.status !== "completed") failing.push(`project status is ${projectRow?.status ?? "unknown"}, not Completed`);
    return fail(
      `This project is no longer ready: ${failing.join("; ")}. Resolve these, or withdraw the book and compile again with a documented override.`
    );
  }

  // Segregation of duties (S7-11): a conditional handover (documented override) needs a JAGS Admin to issue it.
  if (dataBook.override_open_punch_items && !isAdminStaff(session)) {
    return fail("Only a JAGS Admin can issue a conditional handover (a book compiled with an override).");
  }

  // Overridden book: re-snapshot what is outstanding NOW, so the certificate records the current state
  // rather than the state at compile time. When everything has since been resolved the snapshot is
  // refreshed to the (empty) current state instead of listing items that are already closed.
  if (dataBook.override_open_punch_items) {
    try {
      const items = needsOverride ? await buildOverrideItems(supabase, projectId, readiness, projectRow?.status) : [];
      const { error: snapError } = await supabase.from(DATA_BOOKS_TABLE).update({ override_items: items }).eq("id", dataBookId).eq("status", "compiled");
      if (snapError) throw new Error(snapError.message);
    } catch (err) {
      console.error("[handover] open-items snapshot refresh failed", err);
      return fail("Could not refresh the list of open items for this Conditional Handover. Nothing was issued — try again.");
    }
  }

  // Atomic claim + certificate insert (see supabase migration: issue_data_book_handover).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated Database type yet
  const { data: certificateId, error: rpcError } = await (supabase.rpc as any)("issue_data_book_handover", {
    p_data_book_id: dataBookId,
    p_package_storage_path: packageStoragePath,
    p_package_sha256: packageSha256,
    p_notes: handoverNotes || null,
    p_certificate_number: certificateNumber || null,
  });

  if (rpcError || !certificateId) {
    return fail(issueErrorMessage(rpcError?.code, rpcError?.message));
  }

  const project = projectRow ? { organization_id: projectRow.organization_id } : null;
  // The RPC assigns the certificate number when none was typed; read it back for notifications and the audit trail.
  const { data: issuedCert } = await supabase
    .from(HANDOVER_CERTIFICATES_TABLE)
    .select("certificate_number")
    .eq("id", String(certificateId))
    .maybeSingle<{ certificate_number: string }>();
  const issuedNumber = issuedCert?.certificate_number ?? certificateNumber ?? "";

  // Notify only client-role users who have access to this project (best-effort, single insert).
  if (project?.organization_id) {
    try {
      const { data: grants } = await supabase
        .from("access_grants")
        .select("user_id, role, scope_type, organization_id, project_id")
        .eq("role", "client")
        .or(`organization_id.eq.${project.organization_id},project_id.eq.${projectId}`)
        .returns<{ user_id: string; role: string; scope_type: string; organization_id: string | null; project_id: string | null }[]>();
      await notifyMany(supabase, {
        organizationId: project.organization_id,
        projectId,
        recipientIds: clientRecipientIds(grants ?? [], { id: projectId, organizationId: project.organization_id }, [session.userId]),
        title: `Handover certificate ${issuedNumber} issued`.replace("  ", " "),
        body: `Data Book ${dataBook.book_number} is ready. Please review and acknowledge receipt.`,
        link: "/inspect/handover",
      });
    } catch {
      // Best-effort.
    }

    try {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "handover_certificate",
        entityId: String(certificateId),
        action: "issued",
        actorId: session.userId,
        summary: `Handover certificate ${issuedNumber} issued${dataBook.override_open_punch_items ? " (conditional)" : ""}`,
      });
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
  }

  // Render the Handover Certificate PDF and the ISSUED Data Book PDF (the worker hashes the book and stores
  // the hash on the certificate, so the book that was certified is the one frozen at issue time, S7-03).
  // Both are best-effort - the certificate row is the formal record - but a failure to queue is reported.
  const [certQueued, bookQueued] = await Promise.all([
    queueHandoverCertificatePdf(supabase, dataBookId, session.userId),
    queueIssuedDataBookPdf(supabase, dataBookId, session.userId),
  ]);
  const notices: string[] = [];
  if (!certQueued) notices.push("the certificate PDF could not be queued");
  if (!bookQueued) notices.push("the Data Book PDF could not be queued");

  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  revalidatePath("/inspect/handover");
  return {
    error: null,
    notice: notices.length > 0 ? `Handover issued, but ${notices.join(" and ")}. Use Generate PDF on the Data Book / Handover page to retry.` : null,
  };
}

export interface AcknowledgeHandoverState {
  error: string | null;
}

/**
 * Formal acceptance of a handover package. Goes through the acknowledge_handover() SECURITY DEFINER
 * function, which enforces the client role, name length, package presence and "Already acknowledged".
 * A JAGS admin may acknowledge on behalf of the client (recorded on the certificate by the RPC).
 * Notifies whoever issued the certificate and the project's responsible person.
 */
export async function acknowledgeHandoverAction(
  _prev: AcknowledgeHandoverState,
  formData: FormData
): Promise<AcknowledgeHandoverState> {
  const certificateId = String(formData.get("certificate_id") ?? "").trim();
  const receivedByName = String(formData.get("received_by_name") ?? "").trim();
  const receivedByCompany = String(formData.get("received_by_company") ?? "").trim();
  const ackComment = String(formData.get("ack_comment") ?? "").trim();
  const onBehalfBasis = String(formData.get("on_behalf_basis") ?? "").trim();
  const confirmed = formData.get("confirm") === "on" || formData.get("confirm") === "true";

  if (!certificateId || !receivedByName) {
    return { error: "Your name is required to acknowledge receipt." };
  }
  if (receivedByName.length > MAX_ACK_NAME_LENGTH || receivedByCompany.length > MAX_ACK_NAME_LENGTH) {
    return { error: `Name and company must be ${MAX_ACK_NAME_LENGTH} characters or fewer.` };
  }
  if (ackComment.length > 2000 || onBehalfBasis.length > 1000) {
    return { error: "The comment (2000) or the on-behalf basis (1000) is too long." };
  }
  if (!confirmed) {
    return { error: "Tick the confirmation box to record this formal acceptance." };
  }

  const session = await requireSession();
  const isClient = !session.isJagsStaff && session.grants.some((g) => g.role === "client");
  const onBehalf = isAdminStaff(session);
  if (!isClient && !onBehalf) {
    return { error: "Only the client organisation can acknowledge receipt of a handover." };
  }
  // On behalf of the client: record WHAT the client actually said or sent (an email, a signed PDF...).
  if (!isClient && onBehalfBasis.length < 5) {
    return { error: "Say how the client confirmed (for example the email or signed document reference) before recording this on their behalf." };
  }

  // Evidence metadata (S7-18): who from where. Best-effort - never blocks the acknowledgement.
  let userAgent: string | null = null;
  let ip: string | null = null;
  try {
    const h = await headers();
    userAgent = h.get("user-agent");
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip");
  } catch {
    // No request context.
  }

  const supabase = await createSupabaseServerClient();
  const baseArgs = {
    target_certificate_id: certificateId,
    received_name: receivedByName,
    received_company: receivedByCompany || null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated Database type yet
  let { error } = await (supabase.rpc as any)("acknowledge_handover", {
    ...baseArgs,
    p_comment: ackComment || null,
    p_user_agent: userAgent,
    p_ip: ip,
    p_on_behalf_basis: !isClient ? onBehalfBasis : null,
  });
  if (error && isMissingDbObject(error)) {
    // The extended RPC arrives with a migration; the 3-argument version keeps working until then.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated Database type yet
    ({ error } = await (supabase.rpc as any)("acknowledge_handover", baseArgs));
  }

  if (error) {
    return { error: acknowledgeErrorMessage(error.message) };
  }

  try {
    const { data: cert } = await supabase
      .from(HANDOVER_CERTIFICATES_TABLE)
      .select("id, data_book_id, certificate_number, issued_by, data_books(project_id, book_number, projects(id, organization_id, responsible_person_id))")
      .eq("id", certificateId)
      .maybeSingle<{
        id: string;
        data_book_id: string;
        certificate_number: string;
        issued_by: string | null;
        data_books: {
          project_id: string;
          book_number: string;
          projects: { id: string; organization_id: string; responsible_person_id: string | null } | null;
        } | null;
      }>();
    const organizationId = cert?.data_books?.projects?.organization_id;
    const projectId = cert?.data_books?.project_id;
    // Re-render the certificate PDF so it now carries the acknowledgement (next vault revision).
    if (cert?.data_book_id) await queueHandoverCertificatePdf(supabase, cert.data_book_id, session.userId);
    if (cert && organizationId && projectId) {
      const who = `${receivedByName}${receivedByCompany ? ` (${receivedByCompany})` : ""}${onBehalf ? " — recorded on behalf of the client by JAGS staff" : ""}`;
      await recordAuditEvent(supabase, {
        organizationId,
        projectId,
        entityType: "handover_certificate",
        entityId: certificateId,
        action: onBehalf ? "acknowledged_on_behalf" : "acknowledged",
        actorId: session.userId,
        summary: `Handover certificate ${cert.certificate_number} acknowledged by ${who}`,
      });
      const recipients = [...new Set([cert.issued_by, cert.data_books?.projects?.responsible_person_id].filter((v): v is string => Boolean(v)))].filter(
        (id) => id !== session.userId
      );
      await notifyMany(supabase, {
        organizationId,
        projectId,
        recipientIds: recipients,
        title: `Handover certificate ${cert.certificate_number} acknowledged`,
        body: `Data Book ${cert.data_books?.book_number ?? ""} receipt was acknowledged by ${who}.`,
        link: `/inspect/projects/${projectId}/data-book`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath("/inspect/handover");
  return { error: null };
}

export interface RequestCertificatePdfState {
  error: string | null;
  success?: boolean;
}

/** Staff-only: (re)queue the Handover Certificate PDF for an issued Data Book — for certificates issued before PDFs existed, or after a failed render. */
export async function requestHandoverCertificatePdfAction(
  _prev: RequestCertificatePdfState,
  formData: FormData
): Promise<RequestCertificatePdfState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can generate the certificate PDF." };
  const dataBookId = String(formData.get("data_book_id") ?? "").trim();
  if (!dataBookId) return { error: "Missing data book." };
  const supabase = await createSupabaseServerClient();
  const ok = await queueHandoverCertificatePdf(supabase, dataBookId, session.userId);
  if (!ok) return { error: "Could not queue the certificate PDF. Try again." };
  revalidatePath("/inspect/handover");
  return { error: null, success: true };
}
