"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { untypedFrom, untypedRpc } from "@/lib/supabase/untyped";
import { notifyOnce } from "./inspection-notifications";
import { fixAssignmentNotification } from "./inspection-notify-logic";

export interface AssignFixState {
  error: string | null;
  saved?: boolean;
}

const schema = z.object({
  inspection_record_id: z.string().uuid("Missing inspection."),
  checklist_item_id: z.string().uuid("Missing item."),
  template_id: z.string().uuid().or(z.literal("")),
  // Empty = clear the assignment.
  assignee_id: z.string().uuid("Pick a person from the list.").or(z.literal("")),
});

/**
 * Names (or, with an empty assignee, clears) who fixes a checklist item answered No. All permission
 * rules live in the assign_checklist_item_fix database function (caller must be allowed to execute
 * the activity; item must be answered No; assignee must have access to the project). This action
 * validates input, calls it, then audits and notifies. Online only: the offline outbox never calls it.
 */
export async function assignChecklistFixAction(_prev: AssignFixState, formData: FormData): Promise<AssignFixState> {
  const parsed = schema.safeParse({
    inspection_record_id: String(formData.get("inspection_record_id") ?? "").trim(),
    checklist_item_id: String(formData.get("checklist_item_id") ?? "").trim(),
    template_id: String(formData.get("template_id") ?? "").trim(),
    assignee_id: String(formData.get("assignee_id") ?? "").trim(),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { inspection_record_id: recordId, checklist_item_id: itemId, template_id: templateId, assignee_id: assigneeId } = parsed.data;

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { error } = await untypedRpc(supabase, "assign_checklist_item_fix", {
    p_inspection_record_id: recordId,
    p_checklist_item_id: itemId,
    p_user_id: assigneeId || null,
  });
  if (error) {
    if (error.code === "42501") return { error: "Only the inspector or the party running this inspection can do this." };
    if (error.code === "22023") return { error: "That person doesn't have access to this project." };
    if (error.code === "55000") return { error: "Only items answered No can have someone assigned to fix them." };
    if (error.code === "P0002") return { error: "Save the No answer first, then pick who fixes it." };
    return { error: "Could not save. Check your connection and try again." };
  }

  try {
    const { data: rec } = await supabase
      .from("inspection_records")
      .select("project_id, projects(organization_id)")
      .eq("id", recordId)
      .maybeSingle<{ project_id: string; projects: { organization_id: string } | null }>();
    const { data: item } = await untypedFrom(supabase, "checklist_items")
      .select("item_number, description")
      .eq("id", itemId)
      .maybeSingle<{ item_number: string; description: string }>();
    const orgId = rec?.projects?.organization_id;
    if (rec && orgId) {
      const label = item ? `${item.item_number} ${item.description}`.trim() : "Checklist item";
      if (assigneeId && assigneeId !== session.userId) {
        const msg = fixAssignmentNotification(label, session.fullName ?? null);
        await notifyOnce(supabase, {
          organizationId: orgId,
          projectId: rec.project_id,
          recipientUserId: assigneeId,
          title: msg.title,
          body: msg.body,
          link: templateId ? `/inspect/checklists/${templateId}` : "/inspect/start-work?assigned=me",
        });
      }
      await recordAuditEvent(supabase, {
        organizationId: orgId,
        projectId: rec.project_id,
        entityType: "checklist_response",
        entityId: itemId,
        action: assigneeId ? "checklist_fix_assigned" : "checklist_fix_cleared",
        actorId: session.userId,
        summary: assigneeId ? `Fix for "${label}" assigned to a team member` : `Fix assignment for "${label}" cleared`,
        changes: { fix_assigned_to: assigneeId || null, inspection_record_id: recordId },
      });
    }
  } catch {
    // Best-effort: the assignment itself already succeeded.
  }

  if (templateId) revalidatePath(`/inspect/checklists/${templateId}`);
  return { error: null, saved: true };
}
