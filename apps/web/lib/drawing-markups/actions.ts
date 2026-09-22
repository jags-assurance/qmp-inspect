"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
import { DRAWING_MARKUPS_TABLE, DRAWING_MARKUP_TYPES, type DrawingMarkupType } from "@/lib/drawing-markups/types";

export interface CreateDrawingMarkupState {
  error: string | null;
}

/**
 * Drops one pin on a vault drawing/plan document. x/y arrive as fractional coordinates (0-1),
 * computed client-side from the click position relative to the rendered document — see
 * drawing-markup-viewer.tsx. Optionally links the pin to an existing NCR from the same project
 * (markup_type 'ncr' + linked_entity_id); the link is application-level only, matching how
 * punch_list_items.source_ncr_id works — no DB FK across the polymorphic target.
 */
export async function createDrawingMarkupAction(
  _prev: CreateDrawingMarkupState,
  formData: FormData
): Promise<CreateDrawingMarkupState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const vaultDocumentId = String(formData.get("vault_document_id") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const x = Number(formData.get("x"));
  const y = Number(formData.get("y"));
  const markupTypeRaw = String(formData.get("markup_type") ?? "note").trim();
  const linkedEntityId = String(formData.get("linked_entity_id") ?? "").trim();

  if (!projectId || !vaultDocumentId || !label) {
    return { error: "A label is required to drop a pin." };
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return { error: "Invalid pin position." };
  }
  const markupType: DrawingMarkupType = (DRAWING_MARKUP_TYPES as readonly string[]).includes(markupTypeRaw)
    ? (markupTypeRaw as DrawingMarkupType)
    : "note";

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: markup, error } = await supabase
    .from(DRAWING_MARKUPS_TABLE)
    .insert({
      project_id: projectId,
      vault_document_id: vaultDocumentId,
      x,
      y,
      markup_type: markupType,
      linked_entity_id: linkedEntityId || null,
      label,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !markup) {
    return { error: "Could not save the pin. Check you have permission and try again." };
  }

  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", projectId)
      .single();
    if (project?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "drawing_markup",
        entityId: markup.id,
        action: "created",
        actorId: user?.id ?? null,
        summary: `Drawing pin "${label}" dropped (${markupType})`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/vault/${projectId}/document/${vaultDocumentId}`);
  return { error: null };
}
