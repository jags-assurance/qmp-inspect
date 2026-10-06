"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import {
  ACTIVITY_EXPECTED_RECORDS_TABLE,
  EXPECTED_RECORD_PROVIDERS,
  PROVIDER_TO_PARTY_TYPES,
  type ActivityExpectedRecordRow,
  type ExpectedRecordProvider,
} from "./db-types";

// R54-R56: the "expected -> received" list for third-party test records/reports (TPI lab test
// certificates, mill certs, etc). Two server actions here: create the pending row (JAGS staff sets
// up the expected list, mirroring who sets up the H/W/R/S grid) and mark one received (the actual
// provider party, or staff on their behalf, once the document exists).

export interface ExpectedRecordActionResult {
  error: string | null;
}

async function findItpIdForItem(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpItemId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("itp_items")
    .select("itp_sections(itp_id)")
    .eq("id", itpItemId)
    .maybeSingle<{ itp_sections: { itp_id: string } | null }>();
  return data?.itp_sections?.itp_id ?? null;
}

async function findOrgAndProjectForItp(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpId: string
): Promise<{ organizationId: string; projectId: string } | null> {
  const { data } = await supabase
    .from("itps")
    .select("project_id, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{ project_id: string; projects: { organization_id: string } | null }>();
  if (!data?.projects?.organization_id) return null;
  return { organizationId: data.projects.organization_id, projectId: data.project_id };
}

/**
 * Staff-only creation of a pending expected record (R56: "At ITP creation the record is listed
 * with its provider and the number left BLANK"). Not restricted to ITP-creation time specifically —
 * the ITP detail page is where activities already live, so this is exposed there instead, but the
 * row still starts out pending/blank exactly per spec.
 */
export async function createExpectedRecordAction(
  _prev: ExpectedRecordActionResult,
  formData: FormData
): Promise<ExpectedRecordActionResult> {
  const session = await requireSession();
  if (!session.isJagsStaff) {
    return { error: "Only JAGS staff can add an expected record." };
  }

  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  const provider = String(formData.get("provider") ?? "").trim() as ExpectedRecordProvider;
  const recordType = String(formData.get("record_type") ?? "").trim();

  if (!itpItemId || !recordType) {
    return { error: "Record type is required." };
  }
  if (!EXPECTED_RECORD_PROVIDERS.includes(provider)) {
    return { error: "Invalid provider." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: record, error } = await supabase
    .from(ACTIVITY_EXPECTED_RECORDS_TABLE)
    .insert({
      itp_item_id: itpItemId,
      provider,
      record_type: recordType,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !record) return { error: "Could not add the expected record. Check you have permission and try again." };

  const itpId = await findItpIdForItem(supabase, itpItemId);
  if (itpId) {
    try {
      const orgAndProject = await findOrgAndProjectForItp(supabase, itpId);
      if (orgAndProject) {
        await recordAuditEvent(supabase, {
          organizationId: orgAndProject.organizationId,
          projectId: orgAndProject.projectId,
          entityType: "expected_record",
          entityId: record.id,
          action: "created",
          actorId: session.userId,
          summary: `Expected record "${recordType}" added (${provider})`,
        });
      }
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
    revalidatePath(`/inspect/itps/${itpId}`);
  }
  return { error: null };
}

/**
 * Marks an expected record received: document number + (already-uploaded) storage path. The file
 * upload itself happens client-side straight to Supabase Storage (same pattern as
 * checklists/[templateId]/photo-upload.tsx) before this action is called with the resulting path —
 * this action only writes the row, it never touches file bytes.
 *
 * Restricted to the party the row's `provider` names (via project_parties.user_id, same check as
 * canSignOffForParty in lib/signoff/actions.ts) or JAGS staff on their behalf.
 */
export async function markExpectedRecordReceivedAction(
  _prev: ExpectedRecordActionResult,
  formData: FormData
): Promise<ExpectedRecordActionResult> {
  const recordId = String(formData.get("record_id") ?? "").trim();
  const documentNumber = String(formData.get("document_number") ?? "").trim();
  const storagePath = String(formData.get("storage_path") ?? "").trim();

  if (!recordId || !documentNumber) {
    return { error: "A document number is required to mark a record received." };
  }
  if (!storagePath) {
    return { error: "Attach the record's file (upload it, or pick it from the vault) before marking it received." };
  }

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: record } = await supabase
    .from(ACTIVITY_EXPECTED_RECORDS_TABLE)
    .select("id, itp_item_id, provider")
    .eq("id", recordId)
    .maybeSingle<Pick<ActivityExpectedRecordRow, "id" | "itp_item_id" | "provider">>();

  if (!record) return { error: "Expected record not found." };

  // The stored path must point at a file that belongs to THIS activity's project: either an upload made
  // for this activity, or a document that really is in this project's vault.
  {
    const { data: pathContext } = await supabase
      .from("itp_items")
      .select("itp_sections(itps(project_id))")
      .eq("id", record.itp_item_id)
      .maybeSingle<{ itp_sections: { itps: { project_id: string } | null } | null }>();
    const itemProjectId = pathContext?.itp_sections?.itps?.project_id ?? null;
    if (!itemProjectId) return { error: "Activity not found, or you don't have access to it." };

    const ownUploadPrefix = `expected-records/${itemProjectId}/${record.itp_item_id}/`;
    if (!storagePath.startsWith(ownUploadPrefix)) {
      const { data: vaultMatch } = await supabase
        .from("vault_documents")
        .select("id, status, vault_folders!inner(project_id)")
        .eq("storage_path", storagePath)
        .eq("vault_folders.project_id", itemProjectId)
        .limit(1)
        .returns<{ id: string; status: string }[]>();
      if (!vaultMatch?.length) {
        return { error: "That file isn't in this project's Document Vault, so it can't be attached." };
      }
      if (vaultMatch[0].status === "superseded" || vaultMatch[0].status === "rejected") {
        return { error: "That vault document is superseded or rejected — attach the current revision instead." };
      }
    }
  }

  if (!session.isJagsStaff) {
    const { data: itpId } = await supabase
      .from("itp_items")
      .select("itp_sections(itps(project_id))")
      .eq("id", record.itp_item_id)
      .maybeSingle<{ itp_sections: { itps: { project_id: string } | null } | null }>();
    const projectId = itpId?.itp_sections?.itps?.project_id ?? null;

    const { data: party } = projectId
      ? await supabase
          .from("project_parties")
          .select("id")
          .eq("project_id", projectId)
          .in("party_type", PROVIDER_TO_PARTY_TYPES[record.provider])
          .eq("user_id", session.userId)
          .maybeSingle<{ id: string }>()
      : { data: null };

    if (!party) {
      return { error: "You can only mark received the records your own party provides." };
    }
  }

  const { error } = await supabase
    .from(ACTIVITY_EXPECTED_RECORDS_TABLE)
    .update({
      document_number: documentNumber,
      storage_path: storagePath,
      received_at: new Date().toISOString(),
    })
    .eq("id", recordId);

  if (error) return { error: "Could not mark the record received. Check you have permission and try again." };

  const itpId = await findItpIdForItem(supabase, record.itp_item_id);
  if (itpId) {
    try {
      const orgAndProject = await findOrgAndProjectForItp(supabase, itpId);
      if (orgAndProject) {
        await recordAuditEvent(supabase, {
          organizationId: orgAndProject.organizationId,
          projectId: orgAndProject.projectId,
          entityType: "expected_record",
          entityId: record.id,
          action: "received",
          actorId: session.userId,
          summary: `Expected record marked received — document ${documentNumber}`,
        });
      }
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
    revalidatePath(`/inspect/itps/${itpId}`);
  }
  return { error: null };
}

/** Staff-only: fix the provider/record type of an expected record that hasn't been received yet. */
export async function updateExpectedRecordAction(
  _prev: ExpectedRecordActionResult,
  formData: FormData
): Promise<ExpectedRecordActionResult> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can edit an expected record." };

  const recordId = String(formData.get("record_id") ?? "").trim();
  const provider = String(formData.get("provider") ?? "").trim() as ExpectedRecordProvider;
  const recordType = String(formData.get("record_type") ?? "").trim();
  if (!recordId || !recordType) return { error: "Record type is required." };
  if (!EXPECTED_RECORD_PROVIDERS.includes(provider)) return { error: "Invalid provider." };

  const supabase = await createSupabaseServerClient();
  const { data: record } = await supabase
    .from(ACTIVITY_EXPECTED_RECORDS_TABLE)
    .select("id, itp_item_id, received_at")
    .eq("id", recordId)
    .maybeSingle<{ id: string; itp_item_id: string; received_at: string | null }>();
  if (!record) return { error: "Expected record not found." };
  if (record.received_at) return { error: "This record has already been received and can no longer be edited." };

  const { data: updated, error } = await supabase
    .from(ACTIVITY_EXPECTED_RECORDS_TABLE)
    .update({ provider, record_type: recordType })
    .eq("id", recordId)
    .select("id");
  if (error || !updated?.length) return { error: "Could not update the expected record. Check you have permission and try again." };

  const itpId = await findItpIdForItem(supabase, record.itp_item_id);
  if (itpId) revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

/** Staff-only: remove an expected record that hasn't been received yet. */
export async function deleteExpectedRecordAction(
  _prev: ExpectedRecordActionResult,
  formData: FormData
): Promise<ExpectedRecordActionResult> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can remove an expected record." };

  const recordId = String(formData.get("record_id") ?? "").trim();
  if (!recordId) return { error: "Missing record." };

  const supabase = await createSupabaseServerClient();
  const { data: record } = await supabase
    .from(ACTIVITY_EXPECTED_RECORDS_TABLE)
    .select("id, itp_item_id, received_at, record_type")
    .eq("id", recordId)
    .maybeSingle<{ id: string; itp_item_id: string; received_at: string | null; record_type: string }>();
  if (!record) return { error: "Expected record not found." };
  if (record.received_at) return { error: "This record has already been received, so it can't be removed." };

  const { data: deleted, error } = await supabase.from(ACTIVITY_EXPECTED_RECORDS_TABLE).delete().eq("id", recordId).select("id");
  if (error || !deleted?.length) return { error: "Could not remove the expected record. Check you have permission and try again." };

  const itpId = await findItpIdForItem(supabase, record.itp_item_id);
  if (itpId) {
    try {
      const orgAndProject = await findOrgAndProjectForItp(supabase, itpId);
      if (orgAndProject) {
        await recordAuditEvent(supabase, {
          organizationId: orgAndProject.organizationId,
          projectId: orgAndProject.projectId,
          entityType: "expected_record",
          entityId: record.id,
          action: "deleted",
          actorId: session.userId,
          summary: `Expected record "${record.record_type}" removed`,
        });
      }
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
    revalidatePath(`/inspect/itps/${itpId}`);
  }
  return { error: null };
}
