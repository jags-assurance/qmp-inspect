"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { AI_USAGE_LOG_TABLE, recordAiReviewDecision } from "@/lib/ai/log";
import { CHECKLIST_TEMPLATES_TABLE } from "./db-types";

export interface ConfirmAiChecklistState {
  error: string | null;
}

/**
 * "Confirm AI-generated checklist": JAGS staff sign off that they reviewed the AI-drafted items.
 * Until then no inspection can start from the template (startInspectionAction and a DB trigger both
 * refuse). Items stay editable while it is a draft; confirming records the AI review decision.
 */
export async function confirmAiChecklistAction(_prev: ConfirmAiChecklistState, formData: FormData): Promise<ConfirmAiChecklistState> {
  const templateId = String(formData.get("template_id") ?? "").trim();
  if (!templateId) return { error: "Missing checklist." };

  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can confirm an AI-generated checklist." };

  const supabase = await createSupabaseServerClient();
  const { data: template } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select("id, itp_item_id, version, ai_generated, ai_confirmed_at, name, itp_items(itp_sections(itps(project_id, projects(organization_id))))")
    .eq("id", templateId)
    .maybeSingle<{
      id: string;
      itp_item_id: string;
      version: number | null;
      ai_generated: boolean;
      ai_confirmed_at: string | null;
      name: string;
      itp_items: { itp_sections: { itps: { project_id: string; projects: { organization_id: string } | null } | null } | null } | null;
    }>();
  if (!template) return { error: "Checklist not found." };
  if (!template.ai_generated) return { error: "This checklist was not AI-generated, so there is nothing to confirm." };
  if (template.ai_confirmed_at) return { error: null };

  const { data: updated, error } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .update({ ai_confirmed_at: new Date().toISOString(), ai_confirmed_by: session.userId })
    .eq("id", templateId)
    .is("ai_confirmed_at", null)
    .select("id")
    .returns<{ id: string }[]>();
  if (error || !updated || updated.length === 0) return { error: "Could not confirm the checklist. Check you have permission and try again." };

  // Best-effort: close the AI usage-log row for this activity with the human decision.
  try {
    const { data: logRow } = await supabase
      .from(AI_USAGE_LOG_TABLE)
      .select("id")
      .eq("feature", "checklist_generation")
      .eq("source_ref->>itpItemId", template.itp_item_id)
      .is("reviewed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (logRow) {
      await recordAiReviewDecision(supabase, {
        logId: logRow.id,
        reviewedBy: session.userId,
        targetType: "checklist_template",
        targetId: templateId,
        reviewedResponse: { checklistTemplateId: templateId },
        decision: (template.version ?? 1) > 1 ? "edited_and_accepted" : "accepted_as_is",
      });
    }
  } catch {
    // Best-effort audit link.
  }

  const itp = template.itp_items?.itp_sections?.itps;
  if (itp?.projects?.organization_id) {
    try {
      await recordAuditEvent(supabase, {
        organizationId: itp.projects.organization_id,
        projectId: itp.project_id,
        entityType: "checklist_template",
        entityId: templateId,
        action: "ai_checklist_confirmed",
        actorId: session.userId,
        summary: `AI-generated checklist "${template.name}" confirmed by staff`,
      });
    } catch {
      // Best-effort.
    }
  }

  revalidatePath(`/inspect/checklists/${templateId}`);
  return { error: null };
}
