"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import {
  CHECKLIST_LIBRARY_TEMPLATES_TABLE,
  CHECKLIST_LIBRARY_ITEMS_TABLE,
  type ChecklistLibraryItemRow,
  type ParsedLibraryItemRow,
} from "./types";
import { CHECKLIST_ITEMS_TABLE, CHECKLIST_TEMPLATES_TABLE } from "@/lib/checklists/db-types";
import { nextSequenceNumber } from "@/lib/numbering/generate";
import { parseLibraryItemsWorkbook } from "./xlsx";

/**
 * R44/R47: a standalone, reusable checklist/form template builder — Tier 1 of the same two-tier
 * pattern as the ITP master library (lib/itp-master/actions.ts): checklist_library_templates/items
 * are JAGS-internal, staff-only definitions built independently of any specific ITP activity.
 * "Attaching" one to a real activity (attachLibraryTemplateToActivityAction below) is what turns a
 * single reusable definition into a real, project-scoped checklist_templates row — the same
 * activity attached across different clients' ITPs each gets its own independent copy, which is
 * what makes one physical template reusable with per-client tweaks (each copy can then be hand-
 * edited via addChecklistItemAction without touching the library original or any other copy).
 */

export interface LibraryTemplateFormState {
  error: string | null;
}

export async function createLibraryTemplateAction(
  _prev: LibraryTemplateFormState,
  formData: FormData
): Promise<LibraryTemplateFormState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can build checklist library templates." };

  const title = String(formData.get("title") ?? "").trim();
  const disciplineId = String(formData.get("discipline_id") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!title) return { error: "A title is required." };

  const supabase = await createSupabaseServerClient();
  const { data: template, error } = await supabase
    .from(CHECKLIST_LIBRARY_TEMPLATES_TABLE)
    .insert({
      title,
      discipline_id: disciplineId || null,
      description: description || null,
      created_by: session.userId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !template) {
    return { error: "Could not create the template. Check you have permission and try again." };
  }

  revalidatePath("/inspect/organisation/checklist-library");
  redirect(`/inspect/organisation/checklist-library/${template.id}`);
}

export async function updateLibraryTemplateAction(
  _prev: LibraryTemplateFormState,
  formData: FormData
): Promise<LibraryTemplateFormState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can edit checklist library templates." };

  const templateId = String(formData.get("template_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const disciplineId = String(formData.get("discipline_id") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!templateId || !title) return { error: "A title is required." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from(CHECKLIST_LIBRARY_TEMPLATES_TABLE)
    .update({ title, discipline_id: disciplineId || null, description: description || null })
    .eq("id", templateId);

  if (error) return { error: "Could not save the changes." };

  revalidatePath(`/inspect/organisation/checklist-library/${templateId}`);
  revalidatePath("/inspect/organisation/checklist-library");
  return { error: null };
}

export interface LibraryItemFormState {
  error: string | null;
}

export async function addLibraryItemAction(
  _prev: LibraryItemFormState,
  formData: FormData
): Promise<LibraryItemFormState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can edit checklist library templates." };

  const templateId = String(formData.get("template_id") ?? "").trim();
  const itemNumber = String(formData.get("item_number") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const acceptanceCriteria = String(formData.get("acceptance_criteria") ?? "").trim();
  const evidenceType = String(formData.get("evidence_type") ?? "").trim();
  const isMandatory = formData.get("is_mandatory") === "on";

  if (!templateId || !itemNumber || !description) {
    return { error: "Item number and description are required." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: siblings } = await supabase
    .from(CHECKLIST_LIBRARY_ITEMS_TABLE)
    .select("sort_order")
    .eq("library_template_id", templateId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .returns<Pick<ChecklistLibraryItemRow, "sort_order">[]>();

  const { error } = await supabase.from(CHECKLIST_LIBRARY_ITEMS_TABLE).insert({
    library_template_id: templateId,
    item_number: itemNumber,
    description,
    acceptance_criteria: acceptanceCriteria || null,
    evidence_type: evidenceType || null,
    is_mandatory: isMandatory,
    sort_order: (siblings?.[0]?.sort_order ?? -1) + 1,
  });

  if (error) {
    return { error: error.code === "23505" ? "That item number is already used on this template." : "Could not add the item." };
  }

  revalidatePath(`/inspect/organisation/checklist-library/${templateId}`);
  return { error: null };
}

export async function deleteLibraryItemAction(
  _prev: LibraryItemFormState,
  formData: FormData
): Promise<LibraryItemFormState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can edit checklist library templates." };

  const itemId = String(formData.get("item_id") ?? "").trim();
  const templateId = String(formData.get("template_id") ?? "").trim();
  if (!itemId || !templateId) return { error: "Missing item." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(CHECKLIST_LIBRARY_ITEMS_TABLE).delete().eq("id", itemId);
  if (error) return { error: "Could not remove the item." };

  revalidatePath(`/inspect/organisation/checklist-library/${templateId}`);
  return { error: null };
}

export interface ParseImportState {
  error: string | null;
  rows: ParsedLibraryItemRow[] | null;
}

/**
 * R47 step 1 of 2: parses an uploaded .xlsx server-side and returns every row for review — nothing
 * is written to the database yet. A malformed row (missing item number/description, a duplicate
 * item number within the file) is flagged in validationError and still returned, never silently
 * dropped, so the reviewer sees exactly what's wrong with it before deciding to fix, remove, or
 * cancel the import.
 */
export async function parseLibraryImportAction(_prev: ParseImportState, formData: FormData): Promise<ParseImportState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can import checklist templates.", rows: null };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an .xlsx file to import.", rows: null };
  }

  const buffer = await file.arrayBuffer();
  const { rows, error } = await parseLibraryItemsWorkbook(buffer);
  if (error) return { error, rows: null };

  return { error: null, rows };
}

export interface CommitImportState {
  error: string | null;
  addedCount: number;
}

/**
 * R47 step 2 of 2: commits the reviewed/edited rows from parseLibraryImportAction as real
 * checklist_library_items. Refuses outright if any row still carries a validationError — the
 * reviewer must fix or remove it in the preview table first, rather than the import silently
 * dropping bad rows while accepting the rest.
 */
export async function commitLibraryImportAction(_prev: CommitImportState, formData: FormData): Promise<CommitImportState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can import checklist templates.", addedCount: 0 };

  const templateId = String(formData.get("template_id") ?? "").trim();
  const rowsJson = String(formData.get("rows_json") ?? "");
  if (!templateId || !rowsJson) return { error: "Missing template or rows.", addedCount: 0 };

  let rows: ParsedLibraryItemRow[];
  try {
    rows = JSON.parse(rowsJson);
  } catch {
    return { error: "Could not read the reviewed rows.", addedCount: 0 };
  }

  if (rows.length === 0) return { error: "No rows to import.", addedCount: 0 };
  if (rows.some((r) => r.validationError)) {
    return { error: "Fix or remove every flagged row before importing.", addedCount: 0 };
  }

  const supabase = await createSupabaseServerClient();

  const { data: siblings } = await supabase
    .from(CHECKLIST_LIBRARY_ITEMS_TABLE)
    .select("sort_order")
    .eq("library_template_id", templateId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .returns<Pick<ChecklistLibraryItemRow, "sort_order">[]>();

  let nextSortOrder = (siblings?.[0]?.sort_order ?? -1) + 1;

  const payload = rows.map((row) => ({
    library_template_id: templateId,
    item_number: row.item_number,
    description: row.description,
    acceptance_criteria: row.acceptance_criteria || null,
    evidence_type: row.evidence_type || null,
    is_mandatory: row.is_mandatory,
    sort_order: nextSortOrder++,
  }));

  const { error } = await supabase.from(CHECKLIST_LIBRARY_ITEMS_TABLE).insert(payload);

  if (error) {
    return {
      error:
        error.code === "23505"
          ? "One or more item numbers already exist on this template — rename them and try again."
          : "Could not import the rows. Check you have permission and try again.",
      addedCount: 0,
    };
  }

  revalidatePath(`/inspect/organisation/checklist-library/${templateId}`);
  return { error: null, addedCount: payload.length };
}

export interface AttachLibraryTemplateState {
  error: string | null;
}

/**
 * Attaches a library template to a specific ITP activity: creates a brand new, real
 * checklist_templates row scoped to that itp_item_id, with its own numbered checklist_number
 * (same "{itp_number}-CHK-{seq}" atomic counter as generateChecklistsForItp), and copies the
 * library's items into real checklist_items rows. No stored link back to the library template is
 * kept — an independent, project-scoped working copy, same reasoning as
 * copyMasterTemplateToItpAction in lib/itp-master/actions.ts. Offered alongside the existing
 * auto-generate-blank-checklist path on the ITP's checklists page.
 *
 * Staff-only: the library itself is staff-only at every level (RLS), so a non-staff party could
 * never have browsed it to pick a template to attach in the first place.
 */
export async function attachLibraryTemplateToActivityAction(
  _prev: AttachLibraryTemplateState,
  formData: FormData
): Promise<AttachLibraryTemplateState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can attach a library template to an activity." };

  const libraryTemplateId = String(formData.get("library_template_id") ?? "").trim();
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  if (!libraryTemplateId || !itpItemId) return { error: "Choose a library template." };

  const supabase = await createSupabaseServerClient();

  const { data: itpItem } = await supabase
    .from("itp_items")
    .select(
      "id, evidence_type, activity, itp_sections(itp_id, itps(itp_number, project_id, projects(organization_id)))"
    )
    .eq("id", itpItemId)
    .maybeSingle<{
      id: string;
      evidence_type: 1 | 2 | 3;
      activity: string;
      itp_sections: {
        itp_id: string;
        itps: { itp_number: string; project_id: string; projects: { organization_id: string } | null } | null;
      } | null;
    }>();

  if (!itpItem) return { error: "Activity not found." };
  if (itpItem.evidence_type !== 1) return { error: "Only a checklist-type activity can have a checklist attached." };

  const itp = itpItem.itp_sections?.itps;
  const itpId = itpItem.itp_sections?.itp_id;
  if (!itp || !itpId) return { error: "Could not resolve this activity's ITP." };

  const { data: existing } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select("id")
    .eq("itp_item_id", itpItemId)
    .maybeSingle<{ id: string }>();
  if (existing) return { error: "This activity already has a checklist." };

  const { data: libraryTemplate } = await supabase
    .from(CHECKLIST_LIBRARY_TEMPLATES_TABLE)
    .select("id, title")
    .eq("id", libraryTemplateId)
    .maybeSingle<{ id: string; title: string }>();
  if (!libraryTemplate) return { error: "Library template not found." };

  const { data: libraryItems } = await supabase
    .from(CHECKLIST_LIBRARY_ITEMS_TABLE)
    .select("item_number, description, acceptance_criteria, evidence_type, is_mandatory, sort_order")
    .eq("library_template_id", libraryTemplateId)
    .order("sort_order")
    .returns<
      Pick<
        ChecklistLibraryItemRow,
        "item_number" | "description" | "acceptance_criteria" | "evidence_type" | "is_mandatory" | "sort_order"
      >[]
    >();

  if (!libraryItems || libraryItems.length === 0) {
    return { error: "That library template has no items to attach." };
  }

  const seq = await nextSequenceNumber(supabase, {
    organizationId: itp.projects?.organization_id ?? "",
    projectId: itp.project_id,
    seqKey: `checklist:${itpId}`,
  });

  const { data: newTemplate, error: templateError } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .insert({
      itp_item_id: itpItemId,
      checklist_number: `${itp.itp_number}-CHK-${seq}`,
      name: itpItem.activity,
    })
    .select("id")
    .single<{ id: string }>();

  if (templateError || !newTemplate) {
    return { error: "Could not attach the template. Check you have permission and try again." };
  }

  const { error: itemsError } = await supabase.from(CHECKLIST_ITEMS_TABLE).insert(
    libraryItems.map((item) => ({
      template_id: newTemplate.id,
      item_number: item.item_number,
      description: item.description,
      acceptance_criteria: item.acceptance_criteria,
      evidence_type: item.evidence_type,
      is_mandatory: item.is_mandatory,
      sort_order: item.sort_order,
    }))
  );

  if (itemsError) {
    return { error: "Checklist created, but its items could not be copied from the library template." };
  }

  revalidatePath(`/inspect/itps/${itpId}/checklists`);
  revalidatePath(`/inspect/checklists/${newTemplate.id}`);
  return { error: null };
}
