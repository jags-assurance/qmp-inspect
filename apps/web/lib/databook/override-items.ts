// Deliberately NOT "use server": takes a live Supabase client and is only called from other server actions.
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { categoriesToOverrideItems, failingReadinessCategories } from "@/lib/databook/helpers";
import type { DataBookReadiness } from "@/lib/databook/readiness";
import type { ConditionalOpenItem } from "@/lib/databook/types";
import { fetchAll } from "@/lib/supabase/fetch-all";

interface OpenPunchRow {
  id: string;
  description: string;
  location: string | null;
  due_date: string | null;
  project_parties: { name: string } | null;
}

/**
 * Snapshot of everything outstanding for a Conditional Handover: every failing readiness category
 * (with counts) plus each open punch item with owner and due date. Pages through ALL open punch items
 * (PostgREST caps one response at 1000 rows) and throws on a read error rather than snapshotting a
 * partial list. Shared with issueHandoverAction, which refreshes the snapshot at issue time.
 */
export async function buildOverrideItems(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  readiness: DataBookReadiness,
  projectStatus: string | null | undefined
): Promise<ConditionalOpenItem[]> {
  const openItems = await fetchAll<OpenPunchRow>((from, to) =>
    supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id, description, location, due_date, project_parties(name)")
      .eq("project_id", projectId)
      .neq("status", "closed")
      .order("id")
      .range(from, to)
      .returns<OpenPunchRow[]>()
  );
  const categoryItems = categoriesToOverrideItems(failingReadinessCategories(readiness).filter((c) => c.category !== "Punch list items closed"));
  if (projectStatus !== "completed") {
    categoryItems.push({
      id: "category:project-status",
      description: `Project status is "${projectStatus ?? "unknown"}", not Completed`,
      location: null,
      due_date: null,
      responsible_party_name: null,
    });
  }
  return [
    ...categoryItems,
    ...openItems.map((item) => ({
      id: item.id,
      description: item.description,
      location: item.location,
      due_date: item.due_date,
      responsible_party_name: item.project_parties?.name ?? null,
    })),
  ];
}

