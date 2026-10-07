"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { bumpRevisionIfIssued, type BumpResult } from "@/lib/itps/revisions";
import { resolveSectionItp, sectionDeleteBlocker } from "@/lib/itps/guards";

// R24: ITP sections are fully editable (add/rename/delete/reorder), not fixed to the 4 defaults
// createItpAction seeds. Every mutation here follows the exact R101 pattern addItpItemAction
// already established in actions.ts: if the ITP has already been issued (approved or
// client_accepted), require a revision_reason and call bumpRevisionIfIssued to freeze the
// pre-edit content into history and bump itps.revision before applying the change.
//
// The ITP a section belongs to is ALWAYS resolved from the section id: the posted itp_id is never
// trusted (it used to decide whether a revision was needed while the write targeted the section, so a
// draft's id could be paired with an issued ITP's section to edit it with no revision and no reason).

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface SectionActionState {
  error: string | null;
}

export type AddSectionState = SectionActionState;

const OK: SectionActionState = { error: null };

/** Locked ITPs (superseded / withdrawn) can't be edited at all. */
const LOCKED_STATUSES = new Set(["superseded", "withdrawn"]);

async function bumpIfIssuedOrError(
  supabase: SupabaseServerClient,
  itpId: string,
  status: string,
  revisionReason: string,
  actionDescription: string
): Promise<{ error: string | null; bump?: BumpResult }> {
  if (LOCKED_STATUSES.has(status)) return { error: `This ITP is ${status} and can no longer be edited.` };
  if (status !== "approved" && status !== "client_accepted") return { error: null };

  if (!revisionReason) {
    return { error: "This ITP has already been issued — a reason is required to change its sections and create a new revision." };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const bump = await bumpRevisionIfIssued(supabase, itpId, `${actionDescription} — ${revisionReason}`, user?.id ?? null);
  return { error: bump.error, bump };
}

export async function addItpSectionAction(_prev: SectionActionState, formData: FormData): Promise<SectionActionState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();

  if (!itpId || !title) {
    return { error: "A section title is required." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: itp } = await supabase.from("itps").select("status").eq("id", itpId).maybeSingle<{ status: string }>();
  if (!itp) return { error: "ITP not found." };

  const gate = await bumpIfIssuedOrError(supabase, itpId, itp.status, revisionReason, `Added section: ${title}`);
  if (gate.error) return { error: gate.error };

  const { data: lastSection } = await supabase
    .from("itp_sections")
    .select("section_number, sort_order")
    .eq("itp_id", itpId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ section_number: number; sort_order: number }>();
  const nextSectionNumber = (lastSection?.section_number ?? 0) + 1;
  const nextSortOrder = (lastSection?.sort_order ?? -1) + 1;

  const { error } = await supabase.from("itp_sections").insert({
    itp_id: itpId,
    section_number: nextSectionNumber,
    title,
    sort_order: nextSortOrder,
  });

  if (error) {
    await gate.bump?.undo?.();
    return { error: "Could not add the section. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return OK;
}

export async function renameItpSectionAction(formData: FormData): Promise<SectionActionState> {
  const sectionId = String(formData.get("section_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();

  if (!sectionId || !title) return { error: "A section title is required." };

  const supabase = await createSupabaseServerClient();
  const section = await resolveSectionItp(supabase, sectionId);
  if (!section) return { error: "Section not found." };

  const gate = await bumpIfIssuedOrError(supabase, section.itpId, section.status, revisionReason, `Renamed section to: ${title}`);
  if (gate.error) return { error: gate.error };

  const { data: updated, error } = await supabase.from("itp_sections").update({ title }).eq("id", sectionId).select("id");
  if (error || !updated?.length) {
    await gate.bump?.undo?.();
    return { error: "Could not rename the section. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/itps/${section.itpId}`);
  return OK;
}

export async function deleteItpSectionAction(formData: FormData): Promise<SectionActionState> {
  const sectionId = String(formData.get("section_id") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();

  if (!sectionId) return { error: "Missing section." };

  const supabase = await createSupabaseServerClient();
  const section = await resolveSectionItp(supabase, sectionId);
  if (!section) return { error: "Section not found." };

  // An ITP should never end up with zero sections — mirrors the "disabled if only section" guard
  // in the UI, enforced server-side too in case that guard is ever bypassed.
  const { count } = await supabase.from("itp_sections").select("id", { count: "exact", head: true }).eq("itp_id", section.itpId);
  if ((count ?? 0) <= 1) return { error: "An ITP needs at least one section." };

  // Deleting a section cascades to its activities and, below them, the inspection history; refuse when
  // ANY activity in it has history (the same rules as deleting one activity). The database enforces this too.
  const blocker = await sectionDeleteBlocker(supabase, sectionId);
  if (blocker) return { error: `This section can't be deleted. ${blocker}` };

  const gate = await bumpIfIssuedOrError(supabase, section.itpId, section.status, revisionReason, "Deleted a section");
  if (gate.error) return { error: gate.error };

  // itp_items.section_id has on delete cascade (supabase/migrations/20260909230000_phase1_itp_core.sql),
  // so this also removes every item in the section — which is why the blocker above must pass first.
  const { data: deleted, error } = await supabase.from("itp_sections").delete().eq("id", sectionId).select("id");
  if (error || !deleted?.length) {
    await gate.bump?.undo?.();
    return { error: "Could not delete the section. It may have inspection history, or you may not have permission." };
  }

  revalidatePath(`/inspect/itps/${section.itpId}`);
  return OK;
}

export type SectionMoveDirection = "up" | "down";

async function moveItpSection(formData: FormData, direction: SectionMoveDirection): Promise<SectionActionState> {
  const sectionId = String(formData.get("section_id") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();

  if (!sectionId) return { error: "Missing section." };

  const supabase = await createSupabaseServerClient();
  const section = await resolveSectionItp(supabase, sectionId);
  if (!section) return { error: "Section not found." };

  const { data: sections } = await supabase
    .from("itp_sections")
    .select("id, section_number, sort_order")
    .eq("itp_id", section.itpId)
    .order("sort_order", { ascending: true })
    .returns<{ id: string; section_number: number; sort_order: number }[]>();

  const ordered = sections ?? [];
  const index = ordered.findIndex((s) => s.id === sectionId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= ordered.length) {
    // Nothing to swap with (already first/last) — no-op.
    return OK;
  }

  const current = ordered[index];
  const neighbor = ordered[swapIndex];

  const gate = await bumpIfIssuedOrError(
    supabase,
    section.itpId,
    section.status,
    revisionReason,
    `Reordered section "${current.section_number}" ${direction === "up" ? "up" : "down"}`
  );
  if (gate.error) return { error: gate.error };

  // Swap both sort_order and section_number so the "{section_number}. {title}" display the UI
  // renders (apps/web/app/inspect/itps/[id]/page.tsx) stays in sync with the new order.
  const first = await supabase
    .from("itp_sections")
    .update({ sort_order: neighbor.sort_order, section_number: neighbor.section_number })
    .eq("id", current.id);
  const second = first.error
    ? first
    : await supabase
        .from("itp_sections")
        .update({ sort_order: current.sort_order, section_number: current.section_number })
        .eq("id", neighbor.id);
  if (first.error || second.error) {
    // Put the first half back if only the second failed, then drop any phantom revision.
    if (!first.error && second.error) {
      await supabase.from("itp_sections").update({ sort_order: current.sort_order, section_number: current.section_number }).eq("id", current.id);
    }
    await gate.bump?.undo?.();
    return { error: "Could not reorder the section. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/itps/${section.itpId}`);
  return OK;
}

export async function moveSectionUpAction(formData: FormData): Promise<SectionActionState> {
  return moveItpSection(formData, "up");
}

export async function moveSectionDownAction(formData: FormData): Promise<SectionActionState> {
  return moveItpSection(formData, "down");
}
