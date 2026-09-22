"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { DATA_BOOKS_TABLE, HANDOVER_CERTIFICATES_TABLE } from "@/lib/databook/types";

export interface IssueHandoverState {
  error: string | null;
}

/**
 * Moves a compiled Data Book to 'issued' and creates its handover certificate — the terminal state
 * that makes it visible in the client-facing Handover Portal. Staff-only (mirrors compiling), and
 * only ever fires off a 'compiled' Data Book, never a draft one.
 */
export async function issueHandoverAction(
  _prev: IssueHandoverState,
  formData: FormData
): Promise<IssueHandoverState> {
  const dataBookId = String(formData.get("data_book_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const certificateNumber = String(formData.get("certificate_number") ?? "").trim();
  const packageStoragePath = String(formData.get("package_storage_path") ?? "").trim();
  const packageSha256 = String(formData.get("package_sha256") ?? "").trim();

  if (!dataBookId || !projectId || !certificateNumber) {
    return { error: "Certificate number is required." };
  }

  // Round-table finding: a certificate must never be issuable without an actual package file behind
  // it — the client is being asked to formally accept receipt of something real, not a placeholder.
  if (!packageStoragePath) {
    return { error: "Upload the handover package file before issuing this certificate." };
  }

  const session = await requireSession();
  if (!session.isJagsStaff) {
    return { error: "Only JAGS staff can issue a handover certificate." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: dataBook } = await supabase
    .from(DATA_BOOKS_TABLE)
    .select("id, status, override_open_punch_items, override_reason, override_items")
    .eq("id", dataBookId)
    .maybeSingle<{
      id: string;
      status: string;
      override_open_punch_items: boolean;
      override_reason: string | null;
      override_items: unknown;
    }>();

  if (!dataBook || dataBook.status !== "compiled") {
    return { error: "Only a compiled Data Book can be issued for handover." };
  }

  // Carries the open-items-at-override snapshot forward onto the certificate itself, so a
  // Conditional Handover reads as a self-contained, permanent record of what was open and agreed
  // at issue time — see 20260920050000_conditional_handover.sql.
  const { data: certificate, error: certError } = await supabase
    .from(HANDOVER_CERTIFICATES_TABLE)
    .insert({
      data_book_id: dataBookId,
      certificate_number: certificateNumber,
      issued_by: user?.id ?? null,
      package_storage_path: packageStoragePath,
      package_sha256: packageSha256 || null,
      is_conditional: dataBook.override_open_punch_items,
      conditional_reason: dataBook.override_open_punch_items ? dataBook.override_reason : null,
      conditional_open_items: dataBook.override_open_punch_items ? dataBook.override_items : null,
    })
    .select("id")
    .single<{ id: string }>();

  if (certError || !certificate) {
    if (certError?.code === "23505") {
      return { error: "A handover certificate already exists for this Data Book." };
    }
    return { error: "Could not issue the handover certificate. Check you have permission and try again." };
  }

  const { error: updateError } = await supabase
    .from(DATA_BOOKS_TABLE)
    .update({ status: "issued" })
    .eq("id", dataBookId);

  if (updateError) {
    return { error: "Certificate issued, but the Data Book status could not be updated." };
  }

  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", projectId)
      .single();
    if (project?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "handover_certificate",
        entityId: certificate.id,
        action: "issued",
        actorId: user?.id ?? null,
        summary: `Handover certificate ${certificateNumber} issued${dataBook.override_open_punch_items ? " (conditional)" : ""}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  revalidatePath("/inspect/handover");
  return { error: null };
}

export interface AcknowledgeHandoverState {
  error: string | null;
}

/**
 * Client-side acknowledgement of receipt. Goes through the acknowledge_handover() SECURITY DEFINER
 * function (see the punch-list/data-book/handover migration) rather than a direct update, since
 * RLS on handover_certificates is staff-only for writes and this is the one narrow exception a
 * non-staff org member is allowed to make on their own handover row.
 */
export async function acknowledgeHandoverAction(
  _prev: AcknowledgeHandoverState,
  formData: FormData
): Promise<AcknowledgeHandoverState> {
  const certificateId = String(formData.get("certificate_id") ?? "").trim();
  const receivedByName = String(formData.get("received_by_name") ?? "").trim();
  const receivedByCompany = String(formData.get("received_by_company") ?? "").trim();

  if (!certificateId || !receivedByName) {
    return { error: "Your name is required to acknowledge receipt." };
  }

  const supabase = await createSupabaseServerClient();
  // acknowledge_handover() isn't in the generated Database type yet (see the module's final report
  // for the addition needed) — narrow, documented escape hatch, same as the table-name casts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)("acknowledge_handover", {
    target_certificate_id: certificateId,
    received_name: receivedByName,
    received_company: receivedByCompany || null,
  });

  if (error) {
    return { error: "Could not record acknowledgement. It may already be acknowledged." };
  }

  try {
    const { data: cert } = await supabase
      .from(HANDOVER_CERTIFICATES_TABLE)
      .select("id, data_books(project_id, projects(id, organization_id))")
      .eq("id", certificateId)
      .maybeSingle<{
        id: string;
        data_books: { project_id: string; projects: { id: string; organization_id: string } | null } | null;
      }>();
    const organizationId = cert?.data_books?.projects?.organization_id;
    const projectId = cert?.data_books?.project_id;
    if (organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId: projectId ?? null,
        entityType: "handover_certificate",
        entityId: certificateId,
        action: "acknowledged",
        summary: `Handover certificate acknowledged by ${receivedByName}${receivedByCompany ? ` (${receivedByCompany})` : ""}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath("/inspect/handover");
  return { error: null };
}
