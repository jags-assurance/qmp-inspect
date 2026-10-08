// Server-only read: activities assigned to one person (itp_items.assigned_to_user_id, 20261114000101).
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { CHECKLIST_TEMPLATES_TABLE, INSPECTION_RECORDS_TABLE } from "./db-types";
import { loadArchivedTemplateIds } from "./archived-templates";
import { filterByArchive } from "./template-ui-logic";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface AssignedActivity {
  templateId: string;
  checklistNumber: string;
  itemNumber: string;
  activity: string;
  itpNumber: string;
  projectName: string;
  plannedDate: string | null;
  status: "not_started" | "in_progress";
}

interface Row {
  id: string;
  checklist_number: string;
  itp_item_id: string;
  itp_items: {
    item_number: string;
    activity: string;
    planned_date: string | null;
    itp_sections: { itps: { itp_number: string; status: string; projects: { name: string } | null } | null } | null;
  } | null;
}

/** Open (not yet passed/completed) activities assigned to `userId` on approved ITPs. Empty if the migration is not applied. */
export async function loadAssignedToMe(supabase: Supabase, userId: string, limit = 50): Promise<AssignedActivity[]> {
  const { data, error } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select(
      "id, checklist_number, itp_item_id, itp_items!inner(item_number, activity, planned_date, assigned_to_user_id, itp_sections(itps(itp_number, status, projects(name))))"
    )
    .eq("itp_items.assigned_to_user_id", userId)
    .limit(limit)
    .returns<Row[]>();
  if (error || !data) return [];

  const archived = await loadArchivedTemplateIds(supabase);
  const active = filterByArchive(data, archived, "active").filter((t) => {
    const st = t.itp_items?.itp_sections?.itps?.status;
    return st === "approved" || st === "client_accepted";
  });
  if (active.length === 0) return [];

  const { data: records } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("checklist_template_id, overall_result")
    .in("checklist_template_id", active.map((t) => t.id))
    .returns<{ checklist_template_id: string | null; overall_result: string | null }[]>();
  const completed = new Set((records ?? []).filter((r) => r.overall_result !== null).map((r) => r.checklist_template_id));
  const inProgress = new Set((records ?? []).filter((r) => r.overall_result === null).map((r) => r.checklist_template_id));

  return active
    .filter((t) => !completed.has(t.id) || inProgress.has(t.id))
    .map((t) => ({
      templateId: t.id,
      checklistNumber: t.checklist_number,
      itemNumber: t.itp_items?.item_number ?? "",
      activity: t.itp_items?.activity ?? "",
      itpNumber: t.itp_items?.itp_sections?.itps?.itp_number ?? "",
      projectName: t.itp_items?.itp_sections?.itps?.projects?.name ?? "",
      plannedDate: t.itp_items?.planned_date ?? null,
      status: inProgress.has(t.id) ? ("in_progress" as const) : ("not_started" as const),
    }))
    .sort((a, b) => (a.plannedDate ?? "9999").localeCompare(b.plannedDate ?? "9999"));
}
