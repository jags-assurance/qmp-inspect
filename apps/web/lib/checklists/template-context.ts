// Not a "use server" file: plain helpers shared by the template / item server actions.
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import {
  CHECKLIST_ITEMS_TABLE,
  CHECKLIST_RESPONSES_TABLE,
  CHECKLIST_TEMPLATES_TABLE,
  INSPECTION_RECORDS_TABLE,
} from "./db-types";
import { nextTemplateVersion } from "./template-logic";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface TemplateContext {
  id: string;
  itpItemId: string;
  checklistNumber: string;
  name: string;
  projectId: string | null;
  organizationId: string | null;
  /** null when the versioning migration (20261106000100) has not been applied. */
  version: number | null;
  archivedAt: string | null;
}

interface TemplateContextRow {
  id: string;
  itp_item_id: string;
  checklist_number: string;
  name: string;
  version?: number | null;
  archived_at?: string | null;
  itp_items: { itp_sections: { itps: { project_id: string; projects: { organization_id: string } | null } | null } | null } | null;
}

function mapRow(row: TemplateContextRow): TemplateContext {
  const itp = row.itp_items?.itp_sections?.itps;
  return {
    id: row.id,
    itpItemId: row.itp_item_id,
    checklistNumber: row.checklist_number,
    name: row.name,
    projectId: itp?.project_id ?? null,
    organizationId: itp?.projects?.organization_id ?? null,
    version: row.version ?? null,
    archivedAt: row.archived_at ?? null,
  };
}

/** RLS-scoped read of a template with its project/organisation (for audit + access checks). */
export async function loadTemplateContext(supabase: Supabase, templateId: string): Promise<TemplateContext | null> {
  const ctxSelect = "itp_items(itp_sections(itps(project_id, projects(organization_id))))";
  const full = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select(`id, itp_item_id, checklist_number, name, version, archived_at, ${ctxSelect}`)
    .eq("id", templateId)
    .maybeSingle<TemplateContextRow>();
  if (!full.error) return full.data ? mapRow(full.data) : null;
  if (!isMissingSchemaError(full.error)) return null;
  // Versioning migration not applied yet: read without the new columns.
  const legacy = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select(`id, itp_item_id, checklist_number, name, ${ctxSelect}`)
    .eq("id", templateId)
    .maybeSingle<TemplateContextRow>();
  return legacy.data ? mapRow(legacy.data) : null;
}

/** Number of inspection responses recorded against any item of this template. */
export async function countTemplateResponses(supabase: Supabase, templateId: string): Promise<number> {
  const { data: items } = await supabase
    .from(CHECKLIST_ITEMS_TABLE)
    .select("id")
    .eq("template_id", templateId)
    .returns<{ id: string }[]>();
  const ids = (items ?? []).map((i) => i.id);
  if (ids.length === 0) return 0;
  const { count } = await supabase
    .from(CHECKLIST_RESPONSES_TABLE)
    .select("id", { count: "exact", head: true })
    .in("checklist_item_id", ids);
  return count ?? 0;
}

export async function countTemplateRecords(supabase: Supabase, templateId: string): Promise<number> {
  const { count } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("checklist_template_id", templateId);
  return count ?? 0;
}

/**
 * Bumps checklist_templates.version after a content change. Best-effort and optimistic (matches the
 * version it read), and a no-op until the versioning migration is applied.
 */
export async function bumpTemplateVersion(supabase: Supabase, templateId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select("version")
    .eq("id", templateId)
    .maybeSingle<{ version: number | null }>();
  if (error || !data) return null;
  const next = nextTemplateVersion(data.version);
  const { error: updError } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .update({ version: next })
    .eq("id", templateId)
    .eq("version", data.version ?? 1);
  if (updError) {
    if (!isMissingSchemaError(updError)) console.error("[checklists] version bump failed", updError.message);
    return null;
  }
  return next;
}
