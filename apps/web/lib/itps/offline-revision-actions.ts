"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { bumpRevisionIfIssued } from "@/lib/itps/revisions";
import { parseItpWorkbook, EVIDENCE_LABEL, type OfflineParsedRow } from "@/lib/itps/offline-workbook";

// R41 — the re-upload half of the AI offline round-trip: AI draft (ai-draft-actions.ts) -> review ->
// confirm into a real ITP -> (this file) export -> edit offline -> re-upload -> new validated
// revision. Works on any ITP, not only AI-drafted ones — see the export route's own doc comment.
//
// Two-step flow, same shape as generateItpDraftAction/createItpFromDraftAction: parseOfflineItpUploadAction
// reads the uploaded workbook and returns a preview diff (nothing written yet); the user reviews that
// diff and types a reason; applyOfflineItpRevisionAction then actually applies it, bumping the
// revision first via bumpRevisionIfIssued — exactly like addItpItemAction/sections.ts already do for
// every other edit-after-issue path in this app.
//
// Staff-only (this file's own gate, not canEditContent's client/contractor-inclusive one): re-uploading
// a whole edited workbook can add, remove and rewrite activities in one shot, well past the scope of
// what a client/contractor's own pre-issue content editing already covers.

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface CurrentItem {
  id: string;
  item_number: string;
  activity: string;
  acceptance_criteria: string | null;
  evidence_type: 1 | 2 | 3;
  discipline_id: string | null;
  sort_order: number;
}

interface CurrentSection {
  id: string;
  section_number: number;
  title: string;
  sort_order: number;
  itp_items: CurrentItem[];
}

async function fetchCurrentSections(supabase: SupabaseServerClient, itpId: string): Promise<CurrentSection[]> {
  const { data } = await supabase
    .from("itp_sections")
    .select(
      "id, section_number, title, sort_order, itp_items(id, item_number, activity, acceptance_criteria, evidence_type, discipline_id, sort_order)"
    )
    .eq("itp_id", itpId)
    .order("section_number")
    .returns<CurrentSection[]>();
  return data ?? [];
}

function groupRowsBySection(rows: OfflineParsedRow[]): Map<number, { title: string; rows: OfflineParsedRow[] }> {
  const grouped = new Map<number, { title: string; rows: OfflineParsedRow[] }>();
  for (const row of rows) {
    const existing = grouped.get(row.sectionNumber);
    if (existing) existing.rows.push(row);
    else grouped.set(row.sectionNumber, { title: row.sectionTitle, rows: [row] });
  }
  return grouped;
}

export interface OfflineDiffItemChange {
  sectionNumber: number;
  itemNumber: string;
  field: string;
  before: string;
  after: string;
}

export interface OfflineDiffRowRef {
  sectionNumber: number;
  itemNumber: string;
  activity: string;
}

export interface OfflineDiffSummary {
  sectionsAdded: { sectionNumber: number; title: string }[];
  sectionsRemoved: { sectionNumber: number; title: string }[];
  itemsAdded: OfflineDiffRowRef[];
  itemsRemoved: OfflineDiffRowRef[];
  itemsChanged: OfflineDiffItemChange[];
  hasChanges: boolean;
}

/**
 * A pure, read-only comparison of the uploaded file's rows against the ITP's current live content —
 * used both for the preview step (nothing written) and, implicitly, by applyOfflineItpRevisionAction
 * (which recomputes it against a fresh read right before writing, so a second browser tab editing the
 * same ITP between preview and confirm can't silently apply a stale diff).
 */
function computeDiff(
  current: CurrentSection[],
  parsedRows: OfflineParsedRow[],
  disciplineCodeById: Map<string, string>
): OfflineDiffSummary {
  const target = groupRowsBySection(parsedRows);
  const currentBySectionNumber = new Map(current.map((s) => [s.section_number, s]));

  const diff: OfflineDiffSummary = {
    sectionsAdded: [],
    sectionsRemoved: [],
    itemsAdded: [],
    itemsRemoved: [],
    itemsChanged: [],
    hasChanges: false,
  };

  for (const [sectionNumber, group] of target) {
    const currentSection = currentBySectionNumber.get(sectionNumber);
    if (!currentSection) {
      diff.sectionsAdded.push({ sectionNumber, title: group.title });
      for (const row of group.rows) {
        diff.itemsAdded.push({ sectionNumber, itemNumber: row.itemNumber, activity: row.activity });
      }
      continue;
    }

    const currentItemsByNumber = new Map(currentSection.itp_items.map((it) => [it.item_number, it]));
    const seenItemNumbers = new Set<string>();

    for (const row of group.rows) {
      seenItemNumbers.add(row.itemNumber);
      const currentItem = currentItemsByNumber.get(row.itemNumber);
      if (!currentItem) {
        diff.itemsAdded.push({ sectionNumber, itemNumber: row.itemNumber, activity: row.activity });
        continue;
      }

      const currentDisciplineCode = currentItem.discipline_id ? disciplineCodeById.get(currentItem.discipline_id) ?? null : null;
      const fields: [string, string, string][] = [
        ["Activity", currentItem.activity, row.activity],
        ["Acceptance criteria", currentItem.acceptance_criteria ?? "", row.acceptanceCriteria],
        ["Evidence type", EVIDENCE_LABEL[currentItem.evidence_type], EVIDENCE_LABEL[row.evidenceType]],
        ["Discipline", currentDisciplineCode ?? "", row.disciplineCode ?? ""],
      ];
      for (const [field, before, after] of fields) {
        if (before !== after) {
          diff.itemsChanged.push({ sectionNumber, itemNumber: row.itemNumber, field, before, after });
        }
      }
    }

    for (const item of currentSection.itp_items) {
      if (!seenItemNumbers.has(item.item_number)) {
        diff.itemsRemoved.push({ sectionNumber, itemNumber: item.item_number, activity: item.activity });
      }
    }

    if (currentSection.title !== group.title) {
      diff.itemsChanged.push({
        sectionNumber,
        itemNumber: "(section title)",
        field: "Section title",
        before: currentSection.title,
        after: group.title,
      });
    }
  }

  for (const section of current) {
    if (!target.has(section.section_number)) {
      diff.sectionsRemoved.push({ sectionNumber: section.section_number, title: section.title });
      for (const item of section.itp_items) {
        diff.itemsRemoved.push({ sectionNumber: section.section_number, itemNumber: item.item_number, activity: item.activity });
      }
    }
  }

  diff.hasChanges =
    diff.sectionsAdded.length > 0 ||
    diff.sectionsRemoved.length > 0 ||
    diff.itemsAdded.length > 0 ||
    diff.itemsRemoved.length > 0 ||
    diff.itemsChanged.length > 0;

  return diff;
}

export interface ParseOfflineUploadState {
  error: string | null;
  itpId: string | null;
  rowsJson: string | null;
  diff: OfflineDiffSummary | null;
}

const EMPTY_PARSE_STATE: ParseOfflineUploadState = { error: null, itpId: null, rowsJson: null, diff: null };

export async function parseOfflineItpUploadAction(
  _prev: ParseOfflineUploadState,
  formData: FormData
): Promise<ParseOfflineUploadState> {
  const session = await requireSession();
  if (!session.isJagsStaff) {
    return { ...EMPTY_PARSE_STATE, error: "Only JAGS staff can re-upload an offline-edited ITP." };
  }

  const itpId = String(formData.get("itp_id") ?? "").trim();
  const file = formData.get("file");
  if (!itpId || !(file instanceof File) || file.size === 0) {
    return { ...EMPTY_PARSE_STATE, error: "Choose the edited .xlsx file to upload." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: itp } = await supabase.from("itps").select("id").eq("id", itpId).maybeSingle<{ id: string }>();
  if (!itp) {
    return { ...EMPTY_PARSE_STATE, error: "ITP not found, or you don't have access to it." };
  }

  const buffer = await file.arrayBuffer();
  const { error: parseError, rows } = await parseItpWorkbook(buffer);
  if (parseError) {
    return { ...EMPTY_PARSE_STATE, error: parseError };
  }

  const [current, { data: disciplines }] = await Promise.all([
    fetchCurrentSections(supabase, itpId),
    supabase.from("master_disciplines").select("id, code").returns<{ id: string; code: string }[]>(),
  ]);
  const disciplineCodeById = new Map((disciplines ?? []).map((d) => [d.id, d.code]));

  const diff = computeDiff(current, rows, disciplineCodeById);
  if (!diff.hasChanges) {
    return { ...EMPTY_PARSE_STATE, error: "No differences found between this file and the ITP's current content — nothing to apply." };
  }

  return { error: null, itpId, rowsJson: JSON.stringify(rows), diff };
}

export interface ApplyOfflineRevisionState {
  error: string | null;
  success: boolean;
}

const EMPTY_APPLY_STATE: ApplyOfflineRevisionState = { error: null, success: false };

export async function applyOfflineItpRevisionAction(
  _prev: ApplyOfflineRevisionState,
  formData: FormData
): Promise<ApplyOfflineRevisionState> {
  const session = await requireSession();
  if (!session.isJagsStaff) {
    return { ...EMPTY_APPLY_STATE, error: "Only JAGS staff can re-upload an offline-edited ITP." };
  }

  const itpId = String(formData.get("itp_id") ?? "").trim();
  const rowsJson = String(formData.get("rows_json") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!itpId || !rowsJson) {
    return { ...EMPTY_APPLY_STATE, error: "The parsed file could not be found — please re-upload it." };
  }
  if (!reason) {
    return { ...EMPTY_APPLY_STATE, error: "A reason for this revision is required." };
  }

  let rows: OfflineParsedRow[];
  try {
    rows = JSON.parse(rowsJson) as OfflineParsedRow[];
  } catch {
    return { ...EMPTY_APPLY_STATE, error: "The parsed file could not be read — please re-upload it." };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ...EMPTY_APPLY_STATE, error: "The uploaded file had no activity rows to apply." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // R101: freeze the pre-edit content and bump itps.revision BEFORE applying anything, exactly like
  // addItpItemAction/sections.ts do — a no-op while the ITP is still draft/under_review.
  const { error: bumpError } = await bumpRevisionIfIssued(
    supabase,
    itpId,
    `Re-uploaded from offline edit — ${reason}`,
    user?.id ?? null
  );
  if (bumpError) {
    return { ...EMPTY_APPLY_STATE, error: bumpError };
  }

  // Re-read current content fresh (not whatever was used to build the preview diff) right before
  // writing, so a stale preview can never clobber a concurrent edit with the wrong sort_order/ids.
  const [current, { data: disciplines }] = await Promise.all([
    fetchCurrentSections(supabase, itpId),
    supabase.from("master_disciplines").select("id, code").returns<{ id: string; code: string }[]>(),
  ]);
  const disciplineIdByCode = new Map((disciplines ?? []).map((d) => [d.code, d.id]));

  // Applied as a sequence of direct upsert/insert/delete calls rather than routing each row through
  // addItpSectionAction/addItpItemAction one at a time: those per-row actions each carry their own
  // bumpRevisionIfIssued call (which would try to snapshot a revision history row per activity in
  // the uploaded file — wrong, since the whole file is one edit) and their own revalidatePath, so
  // reusing them here would mean either calling a "skip the bump" variant of each (more surface
  // area than reusing them buys) or bumping the revision N times for one upload. A single bump above,
  // then a plain batch of writes below, matches what a "re-upload creates one new revision" import
  // actually is.
  const target = groupRowsBySection(rows);
  const currentBySectionNumber = new Map(current.map((s) => [s.section_number, s]));
  let nextSectionSortOrder = current.length > 0 ? Math.max(...current.map((s) => s.sort_order)) + 1 : 0;

  const sectionIdByNumber = new Map<number, string>();
  for (const [sectionNumber, group] of target) {
    const existing = currentBySectionNumber.get(sectionNumber);
    if (existing) {
      sectionIdByNumber.set(sectionNumber, existing.id);
      if (existing.title !== group.title) {
        await supabase.from("itp_sections").update({ title: group.title }).eq("id", existing.id);
      }
      continue;
    }
    const { data: inserted, error: insertError } = await supabase
      .from("itp_sections")
      .insert({ itp_id: itpId, section_number: sectionNumber, title: group.title, sort_order: nextSectionSortOrder })
      .select("id")
      .single();
    nextSectionSortOrder += 1;
    if (insertError || !inserted) {
      return { ...EMPTY_APPLY_STATE, error: "The revision was recorded, but a new section from the file could not be added." };
    }
    sectionIdByNumber.set(sectionNumber, inserted.id);
  }

  // Sections present in the ITP but absent from the uploaded file — cascades to their items
  // (itp_items.section_id has ON DELETE CASCADE).
  for (const section of current) {
    if (!target.has(section.section_number)) {
      await supabase.from("itp_sections").delete().eq("id", section.id);
    }
  }

  for (const [sectionNumber, group] of target) {
    const sectionId = sectionIdByNumber.get(sectionNumber);
    if (!sectionId) continue;
    const existingSection = currentBySectionNumber.get(sectionNumber);
    const currentItemsByNumber = new Map((existingSection?.itp_items ?? []).map((it) => [it.item_number, it]));
    const seenItemNumbers = new Set<string>();

    for (const [index, row] of group.rows.entries()) {
      seenItemNumbers.add(row.itemNumber);
      const disciplineId = row.disciplineCode ? disciplineIdByCode.get(row.disciplineCode) ?? null : null;
      const existingItem = currentItemsByNumber.get(row.itemNumber);
      if (existingItem) {
        await supabase
          .from("itp_items")
          .update({
            activity: row.activity,
            acceptance_criteria: row.acceptanceCriteria || null,
            evidence_type: row.evidenceType,
            discipline_id: disciplineId,
            sort_order: index,
          })
          .eq("id", existingItem.id);
      } else {
        await supabase.from("itp_items").insert({
          section_id: sectionId,
          item_number: row.itemNumber,
          activity: row.activity,
          acceptance_criteria: row.acceptanceCriteria || null,
          evidence_type: row.evidenceType,
          discipline_id: disciplineId,
          sort_order: index,
        });
      }
    }

    if (existingSection) {
      for (const item of existingSection.itp_items) {
        if (!seenItemNumbers.has(item.item_number)) {
          await supabase.from("itp_items").delete().eq("id", item.id);
        }
      }
    }
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null, success: true };
}
