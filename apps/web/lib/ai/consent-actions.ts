"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { consentConfirmationError } from "@/lib/ai/gate-decision";

export interface AiConsentState {
  error: string | null;
  message: string | null;
}

/**
 * E-09: a JAGS Admin switches an organisation's AI consent on or off. Switching on needs the organisation's
 * short name typed as confirmation; either way it is audited (who, when, new value), and the database stamps
 * ai_consent_at / ai_consent_by and appends to ai_consent_history. Withdrawing consent takes effect on the
 * next AI call because the gate reads the live value every time.
 */
export async function setAiConsentAction(_prev: AiConsentState, formData: FormData): Promise<AiConsentState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can change AI consent.", message: null };

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const enable = String(formData.get("enable") ?? "") === "true";
  if (!organizationId) return { error: "Missing organisation.", message: null };

  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, ai_consent")
    .eq("id", organizationId)
    .maybeSingle<{ id: string; name: string; slug: string; ai_consent: boolean }>();
  if (!org) return { error: "Organisation not found.", message: null };
  if (org.ai_consent === enable) return { error: `AI consent is already ${enable ? "given" : "withdrawn"} for ${org.name}.`, message: null };

  const confirmError = consentConfirmationError(enable, org.slug, String(formData.get("confirm") ?? ""));
  if (confirmError) return { error: confirmError, message: null };

  const { data: updated, error } = await supabase
    .from("organizations")
    .update({ ai_consent: enable })
    .eq("id", organizationId)
    .eq("ai_consent", org.ai_consent)
    .select("id");
  if (error || !updated?.length) return { error: "Could not change AI consent. Refresh and try again.", message: null };

  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "organization",
    entityId: organizationId,
    action: enable ? "ai_consent_given" : "ai_consent_withdrawn",
    actorId: session.userId,
    summary: `AI consent ${enable ? "given" : "withdrawn"} for ${org.name}`,
  });

  revalidatePath("/inspect/organisation/clients");
  return { error: null, message: `AI consent ${enable ? "given" : "withdrawn"} for ${org.name}.` };
}
