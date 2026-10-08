"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { canExecuteItpItem } from "./execution-parties";
import { CHECKLIST_ITEMS_TABLE, CHECKLIST_RESPONSES_TABLE, INSPECTION_RECORDS_TABLE } from "./db-types";
import { selectCloneableResponses, type PreviousResponse } from "./clone-logic";
import { loadNumericSpecsForTemplate } from "./numeric-spec-query";

export interface CloneAnswersState {
  error: string | null;
  copied?: number;
}

/**
 * Pre-fills a draft inspection from the most recent COMPLETED inspection on the same checklist. Only Yes and
 * N/A answers for items not yet answered are copied (see clone-logic.ts); the inspector still reviews and
 * can change every one. Audited.
 */
export async function cloneLastAnswersAction(_prev: CloneAnswersState, formData: FormData): Promise<CloneAnswersState> {
  const recordId = String(formData.get("inspection_record_id") ?? "").trim();
  if (!recordId) return { error: "Missing inspection record." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id, project_id, itp_item_id, checklist_template_id, overall_result, record_number, projects(organization_id)")
    .eq("id", recordId)
    .maybeSingle<{
      id: string;
      project_id: string;
      itp_item_id: string;
      checklist_template_id: string | null;
      overall_result: string | null;
      record_number: string;
      projects: { organization_id: string } | null;
    }>();
  if (!record || !record.checklist_template_id) return { error: "Inspection not found, or you do not have access to it." };
  if (record.overall_result) return { error: "This inspection is already completed." };
  if (!(await canExecuteItpItem(supabase, record.itp_item_id))) {
    return { error: "Only JAGS staff or the party assigned to this activity can record answers." };
  }

  const { data: last } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id, record_number")
    .eq("checklist_template_id", record.checklist_template_id)
    .not("overall_result", "is", null)
    .neq("id", record.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; record_number: string }>();
  if (!last) return { error: "There is no earlier completed inspection of this checklist to copy from." };

  const [{ data: items }, { data: previous }, { data: current }, numericSpecs] = await Promise.all([
    supabase.from(CHECKLIST_ITEMS_TABLE).select("id").eq("template_id", record.checklist_template_id).returns<{ id: string }[]>(),
    supabase.from(CHECKLIST_RESPONSES_TABLE).select("checklist_item_id, result, comment").eq("inspection_record_id", last.id).returns<PreviousResponse[]>(),
    supabase.from(CHECKLIST_RESPONSES_TABLE).select("checklist_item_id").eq("inspection_record_id", record.id).returns<{ checklist_item_id: string }[]>(),
    loadNumericSpecsForTemplate(supabase, record.checklist_template_id),
  ]);

  const rows = selectCloneableResponses(
    previous ?? [],
    new Set((items ?? []).map((i) => i.id)),
    new Set((current ?? []).map((c) => c.checklist_item_id)),
    new Set(numericSpecs.keys())
  );
  if (rows.length === 0) return { error: "Nothing to copy: every item is already answered, or the earlier answers were failures or measurements." };

  const { error } = await supabase.from(CHECKLIST_RESPONSES_TABLE).insert(
    rows.map((r) => ({ inspection_record_id: record.id, checklist_item_id: r.checklist_item_id, result: r.result, comment: r.comment }))
  );
  if (error) return { error: "Could not copy the earlier answers. Check you have permission and try again." };

  const orgId = record.projects?.organization_id;
  if (orgId) {
    try {
      await recordAuditEvent(supabase, {
        organizationId: orgId,
        projectId: record.project_id,
        entityType: "inspection_record",
        entityId: record.id,
        action: "answers_prefilled",
        actorId: session.userId,
        summary: `${rows.length} answer(s) on ${record.record_number} pre-filled from ${last.record_number}`,
        changes: { source_record: last.record_number, copied: rows.length },
      });
    } catch {
      // Best-effort audit.
    }
  }
  return { error: null, copied: rows.length };
}
