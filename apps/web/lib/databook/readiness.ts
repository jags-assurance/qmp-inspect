import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";

export interface ReadinessCategory {
  label: string;
  ready: number;
  total: number;
  /** 100 when total is 0 — an empty category has nothing outstanding, so it doesn't hold up compilation. */
  percentage: number;
}

export interface DataBookReadiness {
  itps: ReadinessCategory;
  inspectionRecords: ReadinessCategory;
  ncrs: ReadinessCategory;
  openPunchItems: number;
  /** Average of the three category percentages — the punch list is tracked separately (R86 requires it at zero, not a percentage). */
  overallPercentage: number;
  /** True only when every category is 100% AND there are zero open punch items — the R86 compile gate. */
  isReady: boolean;
}

function toCategory(label: string, ready: number, total: number): ReadinessCategory {
  return { label, ready, total, percentage: total === 0 ? 100 : Math.round((ready / total) * 100) };
}

/**
 * Live readiness calculation for a project's Data Book (R86): computed from existing tables on
 * every call rather than stored, so it always reflects the project's current state.
 */
export async function computeDataBookReadiness(projectId: string): Promise<DataBookReadiness> {
  const supabase = await createSupabaseServerClient();

  const [{ data: itps }, { data: inspectionRecords }, { data: ncrs }, { count: openPunchItems }] =
    await Promise.all([
      supabase.from("itps").select("id, status").eq("project_id", projectId).returns<
        { id: string; status: string }[]
      >(),
      supabase
        .from("inspection_records")
        .select("id, irns(id)")
        .eq("project_id", projectId)
        .returns<{ id: string; irns: { id: string }[] | { id: string } | null }[]>(),
      supabase.from("ncrs" as any).select("id, status").eq("project_id", projectId).returns<
        { id: string; status: string }[]
      >(),
      supabase
        .from(PUNCH_LIST_ITEMS_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("status", "open"),
    ]);

  const itpTotal = itps?.length ?? 0;
  const itpReady = (itps ?? []).filter((itp) => itp.status === "approved" || itp.status === "client_accepted").length;

  const recordTotal = inspectionRecords?.length ?? 0;
  const recordReady = (inspectionRecords ?? []).filter((record) =>
    Array.isArray(record.irns) ? record.irns.length > 0 : record.irns !== null
  ).length;

  const ncrTotal = ncrs?.length ?? 0;
  const ncrReady = (ncrs ?? []).filter((ncr) => ncr.status === "closed").length;

  const itpsCategory = toCategory("ITPs approved or client-accepted", itpReady, itpTotal);
  const inspectionRecordsCategory = toCategory("Inspection records with an issued IRN", recordReady, recordTotal);
  const ncrsCategory = toCategory("NCRs closed", ncrReady, ncrTotal);

  const overallPercentage = Math.round(
    (itpsCategory.percentage + inspectionRecordsCategory.percentage + ncrsCategory.percentage) / 3
  );

  const openPunchItemCount = openPunchItems ?? 0;

  return {
    itps: itpsCategory,
    inspectionRecords: inspectionRecordsCategory,
    ncrs: ncrsCategory,
    openPunchItems: openPunchItemCount,
    overallPercentage,
    isReady:
      itpsCategory.percentage === 100 &&
      inspectionRecordsCategory.percentage === 100 &&
      ncrsCategory.percentage === 100 &&
      openPunchItemCount === 0,
  };
}
