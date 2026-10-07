"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { getRegisterAccess } from "@/lib/registers/permissions";
import { planRegisterImport, registerImportKey } from "@/lib/registers/csv-import";
import type { CsvRegisterKind } from "@/lib/registers/csv-columns";
import { CALIBRATION_REGISTER_TABLE, MATERIAL_REGISTER_TABLE, PERSONNEL_CERTIFICATIONS_TABLE, WELDER_QUALIFICATION_REGISTER_TABLE } from "@/lib/registers/types";

export interface ImportRegisterCsvState {
  error: string | null;
  /** Per-line problems; nothing is imported unless this is empty. */
  lineErrors: string[];
  imported: number | null;
  duplicates: number;
}

const TABLES = {
  calibration: CALIBRATION_REGISTER_TABLE,
  welder: WELDER_QUALIFICATION_REGISTER_TABLE,
  material: MATERIAL_REGISTER_TABLE,
  personnel: PERSONNEL_CERTIFICATIONS_TABLE,
} as const;

const FAIL = (error: string, lineErrors: string[] = []): ImportRegisterCsvState => ({ error, lineErrors, imported: null, duplicates: 0 });

/**
 * Bulk-adds register entries from pasted CSV text or an uploaded .csv. All-or-nothing: any bad line
 * rejects the whole import (the errors list every one) so a half-imported register is never left behind.
 * Rows typed in by non-staff stay unverified, exactly like the single-row form.
 */
export async function importRegisterCsvAction(_prev: ImportRegisterCsvState, formData: FormData): Promise<ImportRegisterCsvState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim() as CsvRegisterKind;
  if (!projectId || !(kind in TABLES)) return FAIL("Missing register.");

  let text = String(formData.get("csv_text") ?? "");
  const file = formData.get("csv_file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 2 * 1024 * 1024) return FAIL("That file is larger than 2 MB.");
    text = await file.text();
  }
  if (!text.trim()) return FAIL("Paste CSV text or choose a .csv file.");

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const access = await getRegisterAccess(supabase, session, projectId);
  if (!access.canAdd) return FAIL("Only JAGS staff and this project's contractor, subcontractor or TPI/lab parties can add register entries.");

  const partyIdByName = new Map<string, string>();
  if (kind === "personnel") {
    const { data: parties } = await supabase.from("project_parties").select("id, name").eq("project_id", projectId).returns<{ id: string; name: string }[]>();
    for (const p of parties ?? []) partyIdByName.set(p.name.trim().toLowerCase(), p.id);
  }

  let existingKeys: Set<string>;
  try {
    // Active rows only (the unique indexes ignore retired / superseded ones); falls back to all rows if the column isn't there yet.
    const load = async (withLifecycle: boolean) =>
      fetchAll<Record<string, unknown>>((from, to) => {
        const base = supabase.from(TABLES[kind]).select("*").eq("project_id", projectId).order("id").range(from, to);
        return (withLifecycle ? base.eq("lifecycle_status", "active") : base).returns<Record<string, unknown>[]>();
      });
    let rows: Record<string, unknown>[];
    try {
      rows = await load(true);
    } catch {
      rows = await load(false);
    }
    existingKeys = new Set(rows.map((r) => registerImportKey(kind, r)).filter((k): k is string => !!k));
  } catch {
    return FAIL("Could not read the existing register to check for duplicates. Try again.");
  }

  const plan = planRegisterImport(kind, text, { partyIdByName, existingKeys });
  if (plan.errors.length > 0) return FAIL(`Nothing was imported: ${plan.errors.length} problem${plan.errors.length === 1 ? "" : "s"} found.`, plan.errors.slice(0, 50));
  if (plan.rows.length === 0) return { error: plan.duplicates > 0 ? "Every row is already in the register." : "No data rows found.", lineErrors: [], imported: 0, duplicates: plan.duplicates };

  const { data: inserted, error } = await supabase
    .from(TABLES[kind])
    .insert(plan.rows.map((r) => ({ ...r, project_id: projectId })))
    .select("id");
  if (error?.code === "23505") return FAIL("Some rows duplicate an existing active entry. Remove them and try again.");
  if (error || !inserted) return FAIL("Could not import. Check you have permission and try again.");

  try {
    const { data: project } = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle<{ organization_id: string }>();
    if (project) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: `${kind}_register_entry`,
        entityId: (inserted as unknown as { id: string }[])[0].id,
        action: "imported",
        actorId: session.userId,
        summary: `${inserted.length} ${kind} register entr${inserted.length === 1 ? "y" : "ies"} imported from CSV`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return { error: null, lineErrors: [], imported: inserted.length, duplicates: plan.duplicates };
}
