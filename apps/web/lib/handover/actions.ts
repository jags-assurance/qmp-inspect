"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
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
    .select("id, status")
    .eq("id", dataBookId)
    .maybeSingle<{ id: string; status: string }>();

  if (!dataBook || dataBook.status !== "compiled") {
    return { error: "Only a compiled Data Book can be issued for handover." };
  }

  const { error: certError } = await supabase.from(HANDOVER_CERTIFICATES_TABLE).insert({
    data_book_id: dataBookId,
    certificate_number: certificateNumber,
    issued_by: user?.id ?? null,
    package_storage_path: packageStoragePath,
    package_sha256: packageSha256 || null,
  });

  if (certError) {
    if (certError.code === "23505") {
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

  revalidatePath("/inspect/handover");
  return { error: null };
}
