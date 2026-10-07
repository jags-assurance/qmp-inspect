import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadItpChecklistPreview, type ItpChecklistPreviewItem } from "@/lib/checklists/preview";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * The checklist-review gate for approving or accepting an ITP: whoever decides must confirm they have
 * reviewed the checklist(s) that go with it ("I have reviewed the checklist" on the form → the
 * `checklist_reviewed` field). Enforced in the server actions (the UI checkbox alone is not the
 * boundary). Returns an error message, or null when the gate passes. An ITP with no checklist-type
 * activities has nothing to review, so it never blocks.
 */
export async function checklistReviewError(supabase: SupabaseClient, itpId: string, formData: FormData): Promise<string | null> {
  if (formData.get("checklist_reviewed") === "on") return null;
  const items = await loadItpChecklistPreview(supabase, itpId);
  return items.some((i) => i.hasChecklist)
    ? "Review the checklist that goes with this ITP and tick the confirmation before you approve or accept it."
    : null;
}

/** Stable fingerprint of what the reviewer was shown: each checklist-type activity with its real or preview lines. */
export function checklistContentHash(items: ItpChecklistPreviewItem[]): string {
  const payload = items
    .filter((i) => i.hasChecklist)
    .map((i) => ({
      item: `${i.sectionNumber}.${i.itemNumber}`,
      activity: i.activity,
      generated: i.generated ? { number: i.generated.number, lines: i.generated.lines } : null,
      preview: i.previewLines,
    }));
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Persists the "I have reviewed the checklist" tick as an audit event: who ticked it, when (the event
 * time), for which decision, and a hash of the checklist content shown (generated checklist items, or the
 * preview built from the activities when none has been generated yet). Best-effort — the decision itself
 * has already succeeded.
 */
export async function recordChecklistReviewTick(
  supabase: SupabaseClient,
  params: { itpId: string; decision: "approve" | "accept" | "review_step"; formData: FormData; actorId: string | null }
): Promise<void> {
  try {
    if (params.formData.get("checklist_reviewed") !== "on") return;
    const [items, { data: itp }] = await Promise.all([
      loadItpChecklistPreview(supabase, params.itpId),
      supabase
        .from("itps")
        .select("itp_number, revision, project_id, projects(organization_id)")
        .eq("id", params.itpId)
        .maybeSingle<{ itp_number: string; revision: number; project_id: string; projects: { organization_id: string } | null }>(),
    ]);
    const organizationId = itp?.projects?.organization_id;
    if (!itp || !organizationId) return;
    const checklistItems = items.filter((i) => i.hasChecklist);
    await recordAuditEvent(supabase, {
      organizationId,
      projectId: itp.project_id,
      entityType: "itp",
      entityId: params.itpId,
      action: "checklist_reviewed",
      actorId: params.actorId,
      summary: `Checklist reviewed before ${params.decision.replace("_", " ")} — ${itp.itp_number} Rev ${itp.revision}, ${checklistItems.length} checklist activit${checklistItems.length === 1 ? "y" : "ies"}, ${checklistItems.filter((i) => i.generated).length} generated`,
      changes: { content_hash: checklistContentHash(items), revision: itp.revision, decision: params.decision, generated: checklistItems.filter((i) => i.generated).length, total: checklistItems.length },
    });
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }
}
