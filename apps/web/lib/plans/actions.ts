"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";

export interface PlanSettingsState {
  error: string | null;
}

const PLAN_TIERS = ["starter", "professional", "enterprise"] as const;
type PlanTier = (typeof PLAN_TIERS)[number];

const PLANS_PATH = "/inspect/organisation/plans";

/**
 * Minimal billing/tariff foundation (see 20260917070000_org_plans_and_seat_limit.sql) — plan tier
 * is informational for now, and seat_limit is the one field with real enforcement, via the
 * access_grants_org_seat_limit trigger. Admin-only, same boundary as every other org-settings
 * screen here.
 */
export async function updateOrgPlanAction(
  _prev: PlanSettingsState,
  formData: FormData
): Promise<PlanSettingsState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can change an organisation's plan." };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const planTierInput = String(formData.get("plan_tier") ?? "").trim();
  const seatLimitRaw = String(formData.get("seat_limit") ?? "").trim();

  if (!organizationId || !planTierInput) {
    return { error: "Organisation and plan tier are required." };
  }
  if (!(PLAN_TIERS as readonly string[]).includes(planTierInput)) {
    return { error: "Unrecognised plan tier." };
  }
  const planTier = planTierInput as PlanTier;

  // Blank means "unlimited seats" (stored as null).
  let seatLimit: number | null = null;
  if (seatLimitRaw) {
    const parsed = Number.parseInt(seatLimitRaw, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      return { error: "Seat limit must be a non-negative whole number, or blank for unlimited." };
    }
    seatLimit = parsed;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("organization_plans")
    .upsert(
      { organization_id: organizationId, plan_tier: planTier, seat_limit: seatLimit },
      { onConflict: "organization_id" }
    );

  if (error) {
    return { error: "Could not save the plan. Check you have permission and try again." };
  }

  revalidatePath(PLANS_PATH);
  return { error: null };
}
