import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { CHECKLIST_ITEMS_TABLE, CHECKLIST_RESPONSES_TABLE } from "./db-types";
import { specFromRow, type NumericSpec } from "./numeric-response";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** The numeric limits of one item, or null for a pass/fail item. Also null when 20261113000500 isn't applied. */
export async function loadNumericSpec(supabase: Client, checklistItemId: string): Promise<NumericSpec | null> {
  const { data, error } = await supabase
    .from(CHECKLIST_ITEMS_TABLE)
    .select("value_type, numeric_min, numeric_max, numeric_unit")
    .eq("id", checklistItemId)
    .maybeSingle<{ value_type: string | null; numeric_min: unknown; numeric_max: unknown; numeric_unit: string | null }>();
  if (error) return null;
  return specFromRow(data);
}

/** Numeric specs for every numeric item on a template, keyed by item id. Empty when the migration isn't applied. */
export async function loadNumericSpecsForTemplate(supabase: Client, templateId: string): Promise<Map<string, NumericSpec>> {
  const out = new Map<string, NumericSpec>();
  const { data, error } = await supabase
    .from(CHECKLIST_ITEMS_TABLE)
    .select("id, value_type, numeric_min, numeric_max, numeric_unit")
    .eq("template_id", templateId)
    .returns<{ id: string; value_type: string | null; numeric_min: unknown; numeric_max: unknown; numeric_unit: string | null }[]>();
  if (error) return out;
  for (const row of data ?? []) {
    const spec = specFromRow(row);
    if (spec) out.set(row.id, spec);
  }
  return out;
}

/** Recorded numeric values for an inspection, keyed by item id. Empty when the migration isn't applied. */
export async function loadNumericValues(supabase: Client, inspectionRecordId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const { data, error } = await supabase
    .from(CHECKLIST_RESPONSES_TABLE)
    .select("checklist_item_id, numeric_value")
    .eq("inspection_record_id", inspectionRecordId)
    .returns<{ checklist_item_id: string; numeric_value: unknown }[]>();
  if (error) return out;
  for (const row of data ?? []) {
    if (row.numeric_value !== null && row.numeric_value !== undefined && Number.isFinite(Number(row.numeric_value))) {
      out.set(row.checklist_item_id, Number(row.numeric_value));
    }
  }
  return out;
}
