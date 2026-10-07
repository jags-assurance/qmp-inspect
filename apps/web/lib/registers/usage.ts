import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { impactedCycleIds, type CalibrationCycle } from "./impact";

export interface RegisterUsageRow {
  id: string;
  result: string;
  inspection_record_id: string;
  checklist_item: { item_number: string; description: string } | null;
  record: {
    id: string;
    record_number: string;
    activity: string;
    overall_result: string | null;
    inspection_date: string;
  } | null;
}

export interface RegisterUsage {
  usage: RegisterUsageRow[];
  /** Calibration cycles (rows linked by supersedes_id) the impacted uses span; 1 for a single row. */
  cycleCount: number;
}

const COLUMN = { calibration: "calibration_asset_id", material: "material_id", welder: "welder_id" } as const;

/**
 * Every checklist answer verified against a register row, paged (never capped). For a calibration the
 * set also spans earlier cycles back to the last one recorded in tolerance (see impact.ts).
 */
export async function fetchRegisterUsage(
  supabase: SupabaseClient,
  params: { kind: "calibration" | "material" | "welder"; id: string; projectId: string | null }
): Promise<RegisterUsage> {
  let ids = [params.id];
  if (params.kind === "calibration" && params.projectId) {
    const { data: cycles, error } = await supabase
      .from("calibration_register")
      .select("id, supersedes_id, as_found_result" as never)
      .eq("project_id", params.projectId)
      .returns<CalibrationCycle[]>();
    if (!error && cycles) ids = impactedCycleIds(params.id, cycles);
  }

  const rows = await fetchAll<RegisterUsageRow>((from, to) =>
    supabase
      .from("checklist_responses")
      .select(
        `id, result, inspection_record_id,
       checklist_item:checklist_items(item_number, description),
       record:inspection_records(id, record_number, activity, overall_result, inspection_date)`
      )
      .in(COLUMN[params.kind], ids)
      .order("id")
      .range(from, to)
      .returns<RegisterUsageRow[]>()
  );
  return {
    usage: rows.sort((a, b) => (b.record?.inspection_date ?? "").localeCompare(a.record?.inspection_date ?? "")),
    cycleCount: ids.length,
  };
}
