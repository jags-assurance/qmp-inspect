"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { nextSequenceNumber, releaseSequence, NumberingError } from "@/lib/numbering/generate";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { CHECKLIST_ITEMS_TABLE, CHECKLIST_TEMPLATES_TABLE, type ChecklistItemRow } from "./db-types";
import { canExecuteItpItem } from "./execution-parties";
import { duplicateTemplateName, templateDeleteDecision } from "./template-logic";
import { countTemplateRecords, loadTemplateContext, type TemplateContext } from "./template-context";

export interface TemplateActionResult {
  error: string | null;
  /** Set by duplicate: the new template's id. */
  templateId?: string;
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const NOT_MIGRATED = "This feature needs a database update that has not been applied yet. Ask an admin to run the latest migrations.";

async function authoriseTemplateMutation(
  supabase: Supabase,
  templateId: string,
  isJagsStaff: boolean
): Promise<{ error: string } | { ctx: TemplateContext }> {
  const ctx = await loadTemplateContext(supabase, templateId);
  if (!ctx) return { error: "Checklist not found." };
  if (!isJagsStaff && !(await canExecuteItpItem(supabase, ctx.itpItemId))) {
    return { error: "Only JAGS staff or the party assigned to this activity can manage this checklist." };
  }
  return { ctx };
}

async function auditTemplate(supabase: Supabase, ctx: TemplateContext, actorId: string, action: string, summary: string, changes?: Record<string, unknown>) {
  if (!ctx.organizationId) return;
  try {
    await recordAuditEvent(supabase, {
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      entityType: "checklist_template",
      entityId: ctx.id,
      action,
      actorId,
      summary,
      changes: changes ?? null,
    });
  } catch {
    // Best-effort.
  }
}

/**
 * Hard-deletes a checklist template and its items. Only allowed while no inspection record exists
 * for it (the DB trigger enforces the same); a used checklist must be archived instead.
 */
export async function deleteChecklistTemplateAction(input: { templateId: string }): Promise<TemplateActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const gate = await authoriseTemplateMutation(supabase, input.templateId, session.isJagsStaff);
  if ("error" in gate) return { error: gate.error };

  if (templateDeleteDecision(await countTemplateRecords(supabase, input.templateId)) === "archive_only") {
    return { error: "This checklist has inspection records, so it cannot be deleted. Archive it instead." };
  }

  const { data: deleted, error } = await supabase.from(CHECKLIST_TEMPLATES_TABLE).delete().eq("id", input.templateId).select("id");
  if (error) {
    return { error: error.code === "42501" ? "This checklist has inspection records, so it cannot be deleted. Archive it instead." : "Could not delete the checklist." };
  }
  if (!deleted || deleted.length === 0) return { error: "Could not delete the checklist. Check you have permission." };

  await auditTemplate(supabase, gate.ctx, session.userId, "template_deleted", `Checklist ${gate.ctx.checklistNumber} deleted: ${gate.ctx.name}`);
  revalidatePath("/inspect/checklists");
  return { error: null };
}

async function setArchived(templateId: string, archive: boolean): Promise<TemplateActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const gate = await authoriseTemplateMutation(supabase, templateId, session.isJagsStaff);
  if ("error" in gate) return { error: gate.error };
  if (archive && gate.ctx.archivedAt) return { error: "This checklist is already archived." };
  if (!archive && !gate.ctx.archivedAt) return { error: "This checklist is not archived." };

  const { data: updated, error } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .update(archive ? { archived_at: new Date().toISOString(), archived_by: session.userId } : { archived_at: null, archived_by: null })
    .eq("id", templateId)
    .select("id");
  if (error) return { error: isMissingSchemaError(error) ? NOT_MIGRATED : "Could not update the checklist." };
  if (!updated || updated.length === 0) return { error: "Could not update the checklist. Check you have permission." };

  await auditTemplate(
    supabase,
    gate.ctx,
    session.userId,
    archive ? "template_archived" : "template_unarchived",
    `Checklist ${gate.ctx.checklistNumber} ${archive ? "archived" : "restored"}: ${gate.ctx.name}`
  );
  revalidatePath(`/inspect/checklists/${templateId}`);
  revalidatePath("/inspect/checklists");
  return { error: null };
}

/** Archives a checklist template (kept for existing inspection records, hidden from new work). */
export async function archiveChecklistTemplateAction(input: { templateId: string }): Promise<TemplateActionResult> {
  return setArchived(input.templateId, true);
}

export async function unarchiveChecklistTemplateAction(input: { templateId: string }): Promise<TemplateActionResult> {
  return setArchived(input.templateId, false);
}

/**
 * Copies a project checklist template (items included, at version 1) onto another activity of the
 * same project that has no checklist yet — checklist_templates is one-per-activity.
 */
export async function duplicateChecklistTemplateAction(input: { templateId: string; targetItpItemId: string }): Promise<TemplateActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const gate = await authoriseTemplateMutation(supabase, input.templateId, session.isJagsStaff);
  if ("error" in gate) return { error: gate.error };
  const source = gate.ctx;

  const { data: target } = await supabase
    .from("itp_items")
    .select("id, activity, itp_sections(itps(id, itp_number, project_id, projects(organization_id)))")
    .eq("id", input.targetItpItemId)
    .maybeSingle<{
      id: string;
      activity: string;
      itp_sections: { itps: { id: string; itp_number: string; project_id: string; projects: { organization_id: string } | null } | null } | null;
    }>();
  const itp = target?.itp_sections?.itps;
  if (!target || !itp) return { error: "Target activity not found." };
  if (itp.project_id !== source.projectId) return { error: "A checklist can only be duplicated onto an activity in the same project." };
  if (target.id === source.itpItemId) return { error: "Choose a different activity to copy this checklist to." };
  if (!session.isJagsStaff && !(await canExecuteItpItem(supabase, target.id))) {
    return { error: "Only JAGS staff or the party assigned to the target activity can add a checklist to it." };
  }

  const { data: existing } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select("id")
    .eq("itp_item_id", target.id)
    .maybeSingle<{ id: string }>();
  if (existing) return { error: "The target activity already has a checklist." };

  const { count: itemCount } = await supabase.from(CHECKLIST_ITEMS_TABLE).select("id", { count: "exact", head: true }).eq("template_id", source.id);
  if (!itemCount) return { error: "The source checklist has no items to copy." };

  let seq: number;
  try {
    seq = await nextSequenceNumber(supabase, {
      organizationId: itp.projects?.organization_id ?? "",
      projectId: itp.project_id,
      seqKey: `checklist:${itp.id}`,
    });
  } catch (err) {
    if (err instanceof NumberingError) return { error: err.message };
    throw err;
  }
  // Hands the number back when nothing is created (B3: a failed save leaves no gap).
  const releaseChecklistNumber = () =>
    releaseSequence(supabase, {
      organizationId: itp.projects?.organization_id ?? "",
      projectId: itp.project_id,
      seqKey: `checklist:${itp.id}`,
      value: seq,
    });
  const checklistNumber = `${itp.itp_number}-CHK-${seq}`;
  const name = target.activity || duplicateTemplateName(source.name); // templates are named after their activity

  let newId: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated Database type yet
  const rpc: { data: unknown; error: { code?: string; message?: string } | null } = await (supabase as any).rpc("duplicate_checklist_template", {
    p_source_template_id: source.id,
    p_target_itp_item_id: target.id,
    p_checklist_number: checklistNumber,
    p_name: name,
  });
  if (!rpc.error && rpc.data) {
    newId = String(rpc.data);
  } else if (rpc.error && isMissingSchemaError(rpc.error)) {
    // Migration 20261106000100 not applied: two-step copy with cleanup.
    const { data: items } = await supabase
      .from(CHECKLIST_ITEMS_TABLE)
      .select("item_number, description, acceptance_criteria, evidence_type, is_mandatory, sort_order")
      .eq("template_id", source.id)
      .order("sort_order")
      .returns<Pick<ChecklistItemRow, "item_number" | "description" | "acceptance_criteria" | "evidence_type" | "is_mandatory" | "sort_order">[]>();
    const { data: created, error: createError } = await supabase
      .from(CHECKLIST_TEMPLATES_TABLE)
      .insert({ itp_item_id: target.id, checklist_number: checklistNumber, name })
      .select("id")
      .single<{ id: string }>();
    if (createError || !created) {
      await releaseChecklistNumber();
      return { error: "Could not duplicate the checklist. Check you have permission and try again." };
    }
    const { error: itemsError } = await supabase
      .from(CHECKLIST_ITEMS_TABLE)
      .insert((items ?? []).map((i) => ({ ...i, template_id: created.id })));
    if (itemsError) {
      await supabase.from(CHECKLIST_TEMPLATES_TABLE).delete().eq("id", created.id);
      await releaseChecklistNumber();
      return { error: "Could not duplicate the checklist items. Nothing was copied." };
    }
    newId = created.id;
  } else {
    // A 23505 means the activity already has a checklist, so this number went unused as well.
    await releaseChecklistNumber();
    return { error: rpc.error?.code === "23505" ? "The target activity already has a checklist." : "Could not duplicate the checklist. Check you have permission and try again." };
  }

  await auditTemplate(supabase, source, session.userId, "template_duplicated", `Checklist ${source.checklistNumber} duplicated to ${checklistNumber}`, {
    new_template_id: newId,
    target_itp_item_id: target.id,
  });
  revalidatePath(`/inspect/checklists/${newId}`);
  return { error: null, templateId: newId };
}
