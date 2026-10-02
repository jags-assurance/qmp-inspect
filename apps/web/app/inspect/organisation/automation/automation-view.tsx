import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrgPickerForm } from "../numbering/org-picker-form";
import { RuleForm } from "./rule-form";
import { PageGuide } from "@/components/domain/page-guide";
import { StatCard } from "@/components/ui/stat-card";
import {
  AUTOMATION_RULES_TABLE,
  AUTOMATION_RULE_TYPES,
  AUTOMATION_RULE_LABEL,
  AUTOMATION_RULE_DESCRIPTION,
  type AutomationRuleRow,
} from "@/lib/automation/types";

interface OrganizationOption {
  id: string;
  name: string;
}

/**
 * The one place in this app that turns "someone should notice X and act" into a real, scheduled
 * nudge instead of relying on a human to happen to look — see worker/src/automation.ts for the
 * periodic sweep that reads these rules and actually sends the notifications. Every rule defaults to
 * a sensible on-state (see the migration) so a fresh organisation gets useful nudges without anyone
 * having to configure anything; this page is for tuning thresholds or turning one off, not required
 * setup. Admin-only, same boundary as Numbering/Module Licensing/Staff Access.
 */
export async function AutomationRulesView({ searchParams, embedded }: {
  searchParams: { org?: string };
  embedded?: boolean;
}) {
  const Heading = embedded ? "h2" : "h1";
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const supabase = await createSupabaseServerClient();
  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, name")
    .order("name")
    .returns<OrganizationOption[]>();

  const { org: orgIdParam } = searchParams;
  const selectedOrg = organizations?.find((o) => o.id === orgIdParam) ?? organizations?.[0] ?? null;

  let rulesByType = new Map<string, AutomationRuleRow>();
  if (selectedOrg) {
    const { data: rules } = await supabase
      .from(AUTOMATION_RULES_TABLE)
      .select("*")
      .eq("organization_id", selectedOrg.id)
      .returns<AutomationRuleRow[]>();
    rulesByType = new Map((rules ?? []).map((r) => [r.rule_type, r]));
  }

  const enabledCount = AUTOMATION_RULE_TYPES.filter((t) => rulesByType.get(t)?.enabled ?? true).length;

  return (
    <div className={embedded ? undefined : "max-w-3xl"}>
      {!embedded && (
<Link href="/inspect" className="text-sm text-burgundy hover:underline">
        ← Back to Dashboard
      </Link>
)}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Heading className="text-2xl font-semibold text-ink">Automation rules</Heading>
        <PageGuide
          title="Automation rules — how this works"
          points={[
            "Every notification elsewhere in this app fires because a person clicked something — these 3 rules are the only time/schedule-driven automation: a background sweep (every ~15 minutes) checks for a stuck Hold, an overdue NCR, or an overdue punch item and sends a real notification without anyone having to notice first.",
            "A rule with no row here yet is ON by default at a sensible threshold — this page is for tuning or disabling, not required setup for a new organisation.",
            "\"Don't repeat within\" stops the same stuck item from re-notifying every single sweep — it fires again only once that many hours have passed since the last nudge for that specific item.",
            "Admin-only, same boundary as Numbering, Module Licensing and Staff Access.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        Configure which conditions automatically nudge your team, instead of relying on someone
        noticing a stuck Hold or an overdue item on their own.
      </p>

      <OrgPickerForm organizations={organizations ?? []} selectedOrgId={selectedOrg?.id ?? null} />

      {selectedOrg && (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Rules enabled" value={`${enabledCount} / ${AUTOMATION_RULE_TYPES.length}`} />
          </div>

          <div className="mt-6 space-y-4">
            {AUTOMATION_RULE_TYPES.map((ruleType) => {
              const rule = rulesByType.get(ruleType);
              return (
                <RuleForm
                  key={ruleType}
                  organizationId={selectedOrg.id}
                  ruleType={ruleType}
                  label={AUTOMATION_RULE_LABEL[ruleType]}
                  description={AUTOMATION_RULE_DESCRIPTION[ruleType]}
                  enabled={rule?.enabled ?? true}
                  thresholdHours={rule?.threshold_hours ?? 24}
                  repeatHours={rule?.repeat_hours ?? 24}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
