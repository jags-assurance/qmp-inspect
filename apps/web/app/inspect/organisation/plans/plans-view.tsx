import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrgPlanForm } from "./org-plan-form";
import { summariseSeatUsage } from "@/lib/plans/seat-limit";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";
import { MoreDetails } from "@/components/domain/more-details";

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
export async function PlansSettingsView({ embedded }: { embedded?: boolean }) {
  const tl = await getTranslator();
  const Heading = embedded ? "h2" : "h1";
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
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="flex flex-wrap items-center gap-2">
        <Heading className="text-2xl font-semibold text-ink"><T>Plans & seats</T></Heading>
        <PageGuide
          title={tl("Plans & seats — how this works")}
          points={[
            "Admin-only. Each organisation's plan tier is informational today — nothing in the app currently gates a feature by tier.",
            "seat_limit is the one enforced setting: a seat is one distinct user holding an organisation- or project-scoped access grant for that client; leave it blank for unlimited.",
            "Enforcement happens in the database, not this page — the access_grants_org_seat_limit trigger blocks the next staff-access grant for that org once the limit is exceeded, with a clear error surfaced back on the Staff Access page.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted"><T>Plan tier and seat limit for each organisation.</T></p>
      <MoreDetails className="mt-1">
        <p><T>Each organisation&rsquo;s plan tier and optional seat cap. A seat is one distinct user holding an organisation- or project-scoped access grant for that client; leave the seat limit blank for unlimited. Exceeding the limit blocks the next staff-access grant for that organisation with a clear error, enforced by the database itself.</T></p>
      </MoreDetails>

      <div className="mt-6 space-y-4">
        {(organizations ?? []).map((org) => {
          const plan = planByOrgId.get(org.id);
          const seatsUsed = seatsUsedByOrgId.get(org.id)?.size ?? 0;
          const usage = summariseSeatUsage(seatsUsed, plan?.seat_limit);
          return (
            <div key={org.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-ink">{org.name}</h2>
                <span className="text-xs text-muted">
                  {seatsUsed} <T>seat</T>{seatsUsed === 1 ? "" : "s"} <T>in use</T>
                  {plan?.seat_limit != null ? ` of ${plan.seat_limit}` : " (unlimited)"}
                  {plan ? ` · ${TIER_LABEL[plan.plan_tier] ?? plan.plan_tier}` : ""}
                </span>
              </div>
              {usage.percent !== null && (
                <div className="mt-2">
                  <div className="h-1.5 w-full overflow-hidden rounded bg-border" role="progressbar" aria-valuenow={usage.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Seat usage for ${org.name}`}>
                    <div className={`h-full ${usage.overLimit ? "bg-danger" : usage.atLimit ? "bg-warning" : "bg-burgundy"}`} style={{ width: `${usage.percent}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {usage.used} <T>of</T> {usage.limit} <T>seats used</T>
                    {usage.overLimit ? " — over the limit (an Admin override was used or the limit was lowered)" : usage.atLimit ? " — full: the next login or staff grant is blocked unless an Admin overrides with a reason" : ""}
                  </p>
                </div>
              )}
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
          <p className="text-sm text-muted"><T>No organisations yet.</T></p>
        )}
      </div>
    </div>
  );
}
