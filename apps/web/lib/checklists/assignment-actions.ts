"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { notifyOnce } from "./inspection-notifications";
import { assignmentNotification } from "./inspection-notify-logic";

export interface AssignActivityState {
  error: string | null;
}

/**
 * Assigns (or, with an empty user, un-assigns) one activity to a specific person. All permission
 * rules live in the assign_activity_to_user database function (staff or the executing party's lead;
 * assignee must be staff or a member of a party on the activity) - this action only calls it, then
 * notifies the assignee.
 */
export async function assignActivityAction(_prev: AssignActivityState, formData: FormData): Promise<AssignActivityState> {
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  const assigneeId = String(formData.get("assignee_id") ?? "").trim();
  const templateId = String(formData.get("template_id") ?? "").trim();
  if (!itpItemId) return { error: "Missing activity." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // Not in the generated types yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("assign_activity_to_user", { p_itp_item_id: itpItemId, p_user_id: assigneeId || null });
  if (error) {
    if (error.code === "42501") return { error: "Only JAGS staff or the executing party's team lead can assign this activity." };
    if (error.code === "22023") return { error: "The assignee must be JAGS staff or a member of a party on this activity." };
    return { error: "Could not assign the activity. Refresh and try again." };
  }

  if (assigneeId) {
    try {
      const { data: item } = await supabase
        .from("itp_items")
        .select("activity, itp_sections(itps(project_id, projects(organization_id)))")
        .eq("id", itpItemId)
        .maybeSingle<{ activity: string; itp_sections: { itps: { project_id: string; projects: { organization_id: string } | null } | null } | null }>();
      const itp = item?.itp_sections?.itps;
      if (item && itp?.projects?.organization_id) {
        if (assigneeId !== session.userId) {
          const msg = assignmentNotification(item.activity, session.fullName ?? null);
          await notifyOnce(supabase, {
            organizationId: itp.projects.organization_id,
            projectId: itp.project_id,
            recipientUserId: assigneeId,
            title: msg.title,
            body: msg.body,
            link: templateId ? `/inspect/checklists/${templateId}` : `/inspect/start-work?assigned=me`,
          });
        }
        await recordAuditEvent(supabase, {
          organizationId: itp.projects.organization_id,
          projectId: itp.project_id,
          entityType: "itp_item",
          entityId: itpItemId,
          action: "activity_assigned",
          actorId: session.userId,
          summary: `Activity "${item.activity}" assigned to a team member`,
          changes: { assigned_to_user_id: assigneeId },
        });
      }
    } catch {
      // Best-effort: the assignment itself already succeeded.
    }
  }

  if (templateId) revalidatePath(`/inspect/checklists/${templateId}`);
  revalidatePath("/inspect/start-work");
  return { error: null };
}
