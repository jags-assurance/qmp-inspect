"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";

export interface SignoffAutomationSettingsState {
  error: string | null;
  saved?: boolean;
}

/**
 * Admin-only: turns the two phase-2 sign-off automations on or off for an organisation (both default
 * off). Checkbox semantics: an unchecked box is absent from the form data, which means off.
 */
export async function updateSignoffAutomationSettingsAction(
  _prev: SignoffAutomationSettingsState,
  formData: FormData
): Promise<SignoffAutomationSettingsState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can change automation settings." };

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  if (!organizationId) return { error: "Organisation is required." };
  const autoNotify = formData.get("auto_notify_signoffs") === "on";
  const autoProceed = formData.get("auto_proceed_after_notice") === "on";

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("organizations")
    .update({ auto_notify_signoffs: autoNotify, auto_proceed_after_notice: autoProceed } as never)
    .eq("id", organizationId);
  if (error) {
    if (isMissingSchemaError(error)) {
      return { error: "These settings need a database update that has not been applied yet." };
    }
    return { error: "Could not save automation settings. Check you have permission and try again." };
  }

  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "organization",
    entityId: organizationId,
    action: "signoff_automation_updated",
    actorId: session.userId,
    summary: `Sign-off automation: notify automatically ${autoNotify ? "on" : "off"}, proceed after notice period ${autoProceed ? "on" : "off"}`,
    changes: { auto_notify_signoffs: autoNotify, auto_proceed_after_notice: autoProceed },
  });

  revalidatePath("/inspect/organisation/numbering");
  return { error: null, saved: true };
}
