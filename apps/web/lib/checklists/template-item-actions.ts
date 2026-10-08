"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { CHECKLIST_ITEMS_TABLE, type ChecklistItemRow } from "./db-types";
import { canExecuteItpItem } from "./execution-parties";
import {
  FROZEN_ITEMS_MESSAGE,
  isItemNumberTaken,
  isTemplateFrozen,
  planReorder,
  validateItemFields,
} from "./template-logic";
import { bumpTemplateVersion, countTemplateResponses, loadTemplateContext, type TemplateContext } from "./template-context";

export interface TemplateItemActionResult {
  error: string | null;
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Shared gate: the template exists (RLS), the caller may maintain it, and its items are not frozen. */
async function authoriseItemMutation(
  supabase: Supabase,
  templateId: string,
  isJagsStaff: boolean
): Promise<{ error: string } | { ctx: TemplateContext }> {
  const ctx = await loadTemplateContext(supabase, templateId);
  if (!ctx) return { error: "Checklist not found." };
  if (!isJagsStaff && !(await canExecuteItpItem(supabase, ctx.itpItemId))) {
    return { error: "Only JAGS staff or the party assigned to this activity can change checklist items." };
  }
  if (ctx.archivedAt) return { error: "This checklist is archived. Restore it before changing its items." };
  if (isTemplateFrozen(await countTemplateResponses(supabase, templateId))) return { error: FROZEN_ITEMS_MESSAGE };
  return { ctx };
}

async function auditItemChange(
  supabase: Supabase,
  ctx: TemplateContext,
  actorId: string,
  action: string,
  summary: string,
  changes?: Record<string, unknown>
): Promise<void> {
  if (!ctx.organizationId) return;
  try {
    await recordAuditEvent(supabase, {
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      entityType: "checklist_item",
      entityId: ctx.id,
      action,
      actorId,
      summary,
      changes: changes ?? null,
    });
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }
}

/** Edits one checklist item's number, description and mandatory flag. Blocked once any response exists. */
export async function updateChecklistItemAction(input: {
  templateId: string;
  itemId: string;
  itemNumber: string;
  description: string;
  isMandatory: boolean;
}): Promise<TemplateItemActionResult> {
  const fieldError = validateItemFields({ itemNumber: input.itemNumber, description: input.description });
  if (fieldError) return { error: fieldError };
  const itemNumber = input.itemNumber.trim();
  const description = input.description.trim();

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const gate = await authoriseItemMutation(supabase, input.templateId, session.isJagsStaff);
  if ("error" in gate) return { error: gate.error };

  const { data: siblings } = await supabase
    .from(CHECKLIST_ITEMS_TABLE)
    .select("id, item_number, description, is_mandatory")
    .eq("template_id", input.templateId)
    .returns<Pick<ChecklistItemRow, "id" | "item_number" | "description" | "is_mandatory">[]>();
  const current = (siblings ?? []).find((s) => s.id === input.itemId);
  if (!current) return { error: "Checklist item not found." };
  if (isItemNumberTaken(siblings ?? [], itemNumber, input.itemId)) return { error: "That item number is already used on this checklist." };
  if (current.item_number === itemNumber && current.description === description && current.is_mandatory === input.isMandatory) {
    return { error: null };
  }

  const { data: updated, error } = await supabase
    .from(CHECKLIST_ITEMS_TABLE)
    .update({ item_number: itemNumber, description, is_mandatory: input.isMandatory })
    .eq("id", input.itemId)
    .eq("template_id", input.templateId)
    .select("id");
  if (error) {
    if (error.code === "23505") return { error: "That item number is already used on this checklist." };
    if (error.code === "42501") return { error: FROZEN_ITEMS_MESSAGE };
    return { error: "Could not update the item." };
  }
  if (!updated || updated.length === 0) return { error: "Could not update the item. Check you have permission." };

  await bumpTemplateVersion(supabase, input.templateId);
  await auditItemChange(supabase, gate.ctx, session.userId, "item_updated", `Checklist item ${current.item_number} edited on ${gate.ctx.checklistNumber}`, {
    before: { item_number: current.item_number, description: current.description, is_mandatory: current.is_mandatory },
    after: { item_number: itemNumber, description, is_mandatory: input.isMandatory },
  });
  revalidatePath(`/inspect/checklists/${input.templateId}`);
  return { error: null };
}

/** Deletes one checklist item. Blocked once any response exists. */
export async function deleteChecklistItemAction(input: { templateId: string; itemId: string }): Promise<TemplateItemActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const gate = await authoriseItemMutation(supabase, input.templateId, session.isJagsStaff);
  if ("error" in gate) return { error: gate.error };

  const { data: item } = await supabase
    .from(CHECKLIST_ITEMS_TABLE)
    .select("id, item_number, description")
    .eq("id", input.itemId)
    .eq("template_id", input.templateId)
    .maybeSingle<Pick<ChecklistItemRow, "id" | "item_number" | "description">>();
  if (!item) return { error: "Checklist item not found." };

  const { data: deleted, error } = await supabase
    .from(CHECKLIST_ITEMS_TABLE)
    .delete()
    .eq("id", input.itemId)
    .eq("template_id", input.templateId)
    .select("id");
  if (error) return { error: error.code === "42501" ? FROZEN_ITEMS_MESSAGE : "Could not delete the item." };
  if (!deleted || deleted.length === 0) return { error: "Could not delete the item. Check you have permission." };

  await bumpTemplateVersion(supabase, input.templateId);
  await auditItemChange(supabase, gate.ctx, session.userId, "item_deleted", `Checklist item ${item.item_number} deleted from ${gate.ctx.checklistNumber}: ${item.description}`);
  revalidatePath(`/inspect/checklists/${input.templateId}`);
  return { error: null };
}

/** Persists a new item order (`orderedItemIds` must be exactly the template's items). Blocked once any response exists. */
export async function reorderChecklistItemsAction(input: { templateId: string; orderedItemIds: string[] }): Promise<TemplateItemActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const gate = await authoriseItemMutation(supabase, input.templateId, session.isJagsStaff);
  if ("error" in gate) return { error: gate.error };

  const { data: items } = await supabase
    .from(CHECKLIST_ITEMS_TABLE)
    .select("id, sort_order")
    .eq("template_id", input.templateId)
    .order("sort_order", { ascending: true })
    .returns<Pick<ChecklistItemRow, "id" | "sort_order">[]>();
  const plan = planReorder((items ?? []).map((i) => i.id), input.orderedItemIds);
  if (!plan.ok) return { error: plan.error };

  const previous = new Map((items ?? []).map((i) => [i.id, i.sort_order]));
  const changed = plan.order.filter((o) => previous.get(o.id) !== o.sort_order);
  if (changed.length === 0) return { error: null };

  for (const o of changed) {
    const { data: updated, error } = await supabase
      .from(CHECKLIST_ITEMS_TABLE)
      .update({ sort_order: o.sort_order })
      .eq("id", o.id)
      .eq("template_id", input.templateId)
      .select("id");
    if (error || !updated || updated.length === 0) {
      // Put the rows already moved back so a partial reorder is never left behind (best-effort).
      for (const done of changed.slice(0, changed.indexOf(o))) {
        await supabase.from(CHECKLIST_ITEMS_TABLE).update({ sort_order: previous.get(done.id) ?? 0 }).eq("id", done.id);
      }
      return { error: error?.code === "42501" ? FROZEN_ITEMS_MESSAGE : "Could not reorder the items." };
    }
  }

  await bumpTemplateVersion(supabase, input.templateId);
  await auditItemChange(supabase, gate.ctx, session.userId, "items_reordered", `Checklist ${gate.ctx.checklistNumber} items reordered`, {
    order: plan.order.map((o) => o.id),
  });
  revalidatePath(`/inspect/checklists/${input.templateId}`);
  return { error: null };
}
