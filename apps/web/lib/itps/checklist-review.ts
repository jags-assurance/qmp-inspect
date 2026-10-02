import type { SupabaseClient } from "@supabase/supabase-js";
import { loadItpChecklistPreview } from "@/lib/checklists/preview";

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
