"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { AUTOMATION_RULES_TABLE, type AutomationRuleType } from "./types";

export interface UpsertAutomationRuleState {
  error: string | null;
}

/**
 * Admin-only, same boundary as Numbering/Module Licensing — configuring what triggers an automated
 * nudge to your own JAGS team is an account-administration concern. Upserts on (organization_id,
 * rule_type) so re-saving the same rule just updates it, no separate create/edit paths needed.
 */
export async function upsertAutomationRuleAction(
  _prev: UpsertAutomationRuleState,
  formData: FormData
): Promise<UpsertAutomationRuleState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can configure automation rules." };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const ruleType = String(formData.get("rule_type") ?? "").trim() as AutomationRuleType;
  const enabled = formData.get("enabled") === "on";
  const thresholdHours = Number(formData.get("threshold_hours") ?? 24);
  const repeatHours = Number(formData.get("repeat_hours") ?? 24);

  if (!organizationId || !ruleType) {
    return { error: "Missing organisation or rule type." };
  }
  if (!Number.isFinite(thresholdHours) || thresholdHours <= 0) {
    return { error: "Threshold hours must be a positive number." };
  }
  if (!Number.isFinite(repeatHours) || repeatHours <= 0) {
    return { error: "Repeat hours must be a positive number." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(AUTOMATION_RULES_TABLE).upsert(
    {
      organization_id: organizationId,
      rule_type: ruleType,
      enabled,
      threshold_hours: Math.round(thresholdHours),
      repeat_hours: Math.round(repeatHours),
    },
    { onConflict: "organization_id,rule_type" }
  );

  if (error) {
    return { error: "Could not save this automation rule. Check you have permission and try again." };
  }

  try {
    await recordAuditEvent(supabase, {
      organizationId,
      entityType: "automation_rule",
      entityId: ruleType,
      action: enabled ? "enabled" : "disabled",
      actorId: session.userId,
      summary: `Automation rule "${ruleType}" ${enabled ? "enabled" : "disabled"} (threshold ${thresholdHours}h, repeat ${repeatHours}h)`,
    });
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath("/inspect/organisation/automation");
  return { error: null };
}
