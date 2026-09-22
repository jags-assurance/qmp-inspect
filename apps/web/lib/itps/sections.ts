"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { bumpRevisionIfIssued } from "@/lib/itps/revisions";

// R24: ITP sections are fully editable (add/rename/delete/reorder), not fixed to the 4 defaults
// createItpAction seeds. Every mutation here follows the exact R101 pattern addItpItemAction
// already established in actions.ts: if the ITP has already been issued (approved or
// client_accepted), require a revision_reason and call bumpRevisionIfIssued to freeze the
// pre-edit content into history and bump itps.revision before applying the change.

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function isItpIssued(supabase: SupabaseServerClient, itpId: string): Promise<boolean> {
  const { data } = await supabase.from("itps").select("status").eq("id", itpId).maybeSingle<{ status: string }>();
  return data?.status === "approved" || data?.status === "client_accepted";
}

async function bumpIfIssuedOrError(
  supabase: SupabaseServerClient,
  itpId: string,
  revisionReason: string,
  actionDescription: string
): Promise<string | null> {
  const issued = await isItpIssued(supabase, itpId);
  if (!issued) return null;

  if (!revisionReason) {
    return "This ITP has already been issued — a reason is required to change its sections and create a new revision.";
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await bumpRevisionIfIssued(supabase, itpId, `${actionDescription} — ${revisionReason}`, user?.id ?? null);
  return error;
}

export interface AddSectionState {
  error: string | null;
}

export async function addItpSectionAction(_prev: AddSectionState, formData: FormData): Promise<AddSectionState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();

  if (!itpId || !title) {
    return { error: "A section title is required." };
  }

  const supabase = await createSupabaseServerClient();

  const bumpError = await bumpIfIssuedOrError(supabase, itpId, revisionReason, `Added section: ${title}`);
  if (bumpError) return { error: bumpError };

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
    return { error: "Could not add the section. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

export async function renameItpSectionAction(formData: FormData) {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const sectionId = String(formData.get("section_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();

  if (!itpId || !sectionId || !title) return;

  const supabase = await createSupabaseServerClient();

  const bumpError = await bumpIfIssuedOrError(supabase, itpId, revisionReason, `Renamed section to: ${title}`);
  if (bumpError) {
    revalidatePath(`/inspect/itps/${itpId}`);
    return;
  }

  await supabase.from("itp_sections").update({ title }).eq("id", sectionId);

  revalidatePath(`/inspect/itps/${itpId}`);
}

export async function deleteItpSectionAction(formData: FormData) {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const sectionId = String(formData.get("section_id") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();

  if (!itpId || !sectionId) return;

  const supabase = await createSupabaseServerClient();

  // An ITP should never end up with zero sections — mirrors the "disabled if only section" guard
  // in the UI, enforced server-side too in case that guard is ever bypassed.
  const { count } = await supabase
    .from("itp_sections")
    .select("id", { count: "exact", head: true })
    .eq("itp_id", itpId);
  if ((count ?? 0) <= 1) {
    revalidatePath(`/inspect/itps/${itpId}`);
    return;
  }

  const bumpError = await bumpIfIssuedOrError(supabase, itpId, revisionReason, "Deleted a section");
  if (bumpError) {
    revalidatePath(`/inspect/itps/${itpId}`);
    return;
  }

  // itp_items.section_id has on delete cascade (supabase/migrations/20260909230000_phase1_itp_core.sql),
  // so this also removes every item in the section.
  await supabase.from("itp_sections").delete().eq("id", sectionId);

  revalidatePath(`/inspect/itps/${itpId}`);
}

export type SectionMoveDirection = "up" | "down";

async function moveItpSection(formData: FormData, direction: SectionMoveDirection) {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const sectionId = String(formData.get("section_id") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();

  if (!itpId || !sectionId) return;

  const supabase = await createSupabaseServerClient();

  const { data: sections } = await supabase
    .from("itp_sections")
    .select("id, section_number, sort_order")
    .eq("itp_id", itpId)
    .order("sort_order", { ascending: true })
    .returns<{ id: string; section_number: number; sort_order: number }[]>();

  const ordered = sections ?? [];
  const index = ordered.findIndex((s) => s.id === sectionId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= ordered.length) {
    // Nothing to swap with (already first/last) — no-op.
    return;
  }

  const current = ordered[index];
  const neighbor = ordered[swapIndex];

  const bumpError = await bumpIfIssuedOrError(
    supabase,
    itpId,
    revisionReason,
    `Reordered section "${current.section_number}" ${direction === "up" ? "up" : "down"}`
  );
  if (bumpError) {
    revalidatePath(`/inspect/itps/${itpId}`);
    return;
  }

  // Swap both sort_order and section_number so the "{section_number}. {title}" display the UI
  // renders (apps/web/app/inspect/itps/[id]/page.tsx) stays in sync with the new order.
  await supabase
    .from("itp_sections")
    .update({ sort_order: neighbor.sort_order, section_number: neighbor.section_number })
    .eq("id", current.id);
  await supabase
    .from("itp_sections")
    .update({ sort_order: current.sort_order, section_number: current.section_number })
    .eq("id", neighbor.id);

  revalidatePath(`/inspect/itps/${itpId}`);
}

export async function moveSectionUpAction(formData: FormData) {
  await moveItpSection(formData, "up");
}

export async function moveSectionDownAction(formData: FormData) {
  await moveItpSection(formData, "down");
}
