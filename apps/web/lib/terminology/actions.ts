"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { TERMINOLOGY_CACHE_TAG } from "./load";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom } from "@/lib/supabase/untyped";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { isTermKey, parseOverrides, validateTermForms, type TermForms, type TermOverrides } from "./terms";

export interface TermState {
  error: string | null;
  success?: string;
}

/** Fixed id for the single platform-wide audit entity (audit_log.entity_id is a uuid). */
const TERMINOLOGY_ENTITY_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Saves (or, with intent=reset, clears) one term's override. Admin-only (also enforced by RLS).
 * Labels only: nothing stored against records changes.
 */
export async function saveTermAction(_prev: TermState, formData: FormData): Promise<TermState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can rename terms." };

  const key = String(formData.get("term_key") ?? "");
  if (!isTermKey(key)) return { error: "Unknown term." };
  const reset = formData.get("intent") === "reset";

  let forms: TermForms | null = null;
  if (!reset) {
    const v = validateTermForms(key, String(formData.get("singular") ?? ""), String(formData.get("plural") ?? ""));
    if (!v.ok) return { error: v.error };
    forms = v.forms;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error: readError } = await untypedFrom(supabase, "terminology_settings")
    .select("terms")
    .eq("id", true)
    .maybeSingle<{ terms: unknown }>();
  if (readError) {
    return {
      error: isMissingSchemaError(readError)
        ? "Terminology is not available yet: the database migration has not been applied."
        : "Could not load the current terms. Try again.",
    };
  }

  const next: TermOverrides = parseOverrides(data?.terms);
  if (forms) next[key] = forms;
  else delete next[key];

  const { error } = await untypedFrom(supabase, "terminology_settings").upsert(
    { id: true, terms: next, updated_at: new Date().toISOString(), updated_by: session.userId },
    { onConflict: "id" }
  );
  if (error) return { error: "Could not save. Check you have permission and try again." };

  await recordAuditEvent(supabase, {
    organizationId: null,
    entityType: "terminology",
    entityId: TERMINOLOGY_ENTITY_ID,
    action: forms ? "term_updated" : "term_reset",
    actorId: session.userId,
    summary: forms ? `Term "${key}" renamed to "${forms.singular}" / "${forms.plural}"` : `Term "${key}" reset to its default`,
    changes: { term_key: key, forms },
  });

  // The labels show on every page (nav, dashboards, registers), so refresh the whole app tree.
  revalidateTag(TERMINOLOGY_CACHE_TAG, { expire: 0 });
  revalidatePath("/inspect", "layout");
  return { error: null, success: forms ? "Saved." : "Reset to default." };
}
