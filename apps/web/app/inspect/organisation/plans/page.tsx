import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrgPlanForm } from "./org-plan-form";
import { PageGuide } from "@/components/domain/page-guide";

interface OrganizationRow {
  id: string;
  name: string;
}

interface PlanRow {
  organization_id: string;
  plan_tier: string;
  seat_limit: number | null;
}

interface GrantRow {
  organization_id: string | null;
  user_id: string;
}

const TIER_LABEL: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};

/**
 * Minimal admin view over the organization_plans billing foundation (see
 * 20260917070000_org_plans_and_seat_limit.sql) — plan tier is informational today, seat_limit is
 * enforced by the access_grants_org_seat_limit trigger the next time a staff grant is added for
 * that org (see lib/staff-access/actions.ts / staff-access page).
 */
export default async function PlansSettingsPage() {
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const supabase = await createSupabaseServerClient();

  const [{ data: organizations }, { data: plans }, { data: grants }] = await Promise.all([
    supabase.from("organizations").select("id, name").order("name").returns<OrganizationRow[]>(),
    supabase.from("organization_plans").select("organization_id, plan_tier, seat_limit").returns<PlanRow[]>(),
    supabase.from("access_grants").select("organization_id, user_id").returns<GrantRow[]>(),
  ]);

  const planByOrgId = new Map((plans ?? []).map((p) => [p.organization_id, p]));

  const seatsUsedByOrgId = new Map<string, Set<string>>();
  for (const grant of grants ?? []) {
    if (!grant.organization_id) continue;
    const set = seatsUsedByOrgId.get(grant.organization_id) ?? new Set<string>();
    set.add(grant.user_id);
    seatsUsedByOrgId.set(grant.organization_id, set);
  }

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-ink">Plans & seats</h1>
        <PageGuide
          title="Plans & seats — how this works"
          points={[
            "Admin-only. Each organisation's plan tier is informational today — nothing in the app currently gates a feature by tier.",
            "seat_limit is the one enforced setting: a seat is one distinct user holding an organisation- or project-scoped access grant for that client; leave it blank for unlimited.",
            "Enforcement happens in the database, not this page — the access_grants_org_seat_limit trigger blocks the next staff-access grant for that org once the limit is exceeded, with a clear error surfaced back on the Staff Access page.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        Each organisation&rsquo;s plan tier and optional seat cap. A seat is one distinct user
        holding an organisation- or project-scoped access grant for that client; leave the seat
        limit blank for unlimited. Exceeding the limit blocks the next staff-access grant for that
        organisation with a clear error, enforced by the database itself.
      </p>

      <div className="mt-6 space-y-4">
        {(organizations ?? []).map((org) => {
          const plan = planByOrgId.get(org.id);
          const seatsUsed = seatsUsedByOrgId.get(org.id)?.size ?? 0;
          return (
            <div key={org.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-ink">{org.name}</h2>
                <span className="text-xs text-muted">
                  {seatsUsed} seat{seatsUsed === 1 ? "" : "s"} in use
                  {plan?.seat_limit != null ? ` of ${plan.seat_limit}` : " (unlimited)"}
                  {plan ? ` · ${TIER_LABEL[plan.plan_tier] ?? plan.plan_tier}` : ""}
                </span>
              </div>
              <div className="mt-3">
                <OrgPlanForm
                  organizationId={org.id}
                  planTier={plan?.plan_tier ?? "professional"}
                  seatLimit={plan?.seat_limit ?? null}
                />
              </div>
            </div>
          );
        })}
        {(organizations ?? []).length === 0 && (
          <p className="text-sm text-muted">No organisations yet.</p>
        )}
      </div>
    </div>
  );
}
