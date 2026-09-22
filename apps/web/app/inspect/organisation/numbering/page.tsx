import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NUMBERING_CONFIGS_TABLE, NUMBERING_DOC_TYPES, type NumberingConfigRow } from "@/lib/numbering/types";
import { listMonthlyReportPacks, listWeeklyReportPacks } from "@/lib/reports/actions";
import {
  ITP_APPROVAL_WORKFLOW_CONFIGS_TABLE,
  type ItpApprovalWorkflowConfigRow,
} from "@/lib/itp-approval-workflow/types";
import { EngagementModeForm } from "./engagement-mode-form";
import { EngagementScopeForm } from "./engagement-scope-form";
import { ItpSequencingModeForm } from "./itp-sequencing-mode-form";
import { NumberingConfigRow as NumberingConfigRowForm } from "./numbering-config-row";
import { OrgPickerForm } from "./org-picker-form";
import { MonthlyReportPackForm } from "./monthly-report-pack-form";
import { WeeklyReportPackForm } from "./weekly-report-pack-form";
import { ItpApprovalWorkflowForm, type StaffOption } from "./itp-approval-workflow-form";
import { isAiConfigured } from "@/lib/ai/gate";

interface OrganizationOption {
  id: string;
  name: string;
  engagement_mode: string;
  engagement_scope: string;
  itp_sequencing_mode: string;
}

export default async function NumberingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // Engagement mode/scope and report-pack generation are administrative (billing/branding/service
  // tier) — Admin-only, unchanged. But a Self-Managed client can configure its OWN organization's
  // document numbering format (20260919050000_self_managed_org_settings.sql), matching "the client
  // manages its own organization" — so a non-staff self-managed user gets this same page scoped to
  // just their own org, with only the numbering section shown (not engagement mode/scope/report
  // packs, which stay Admin-only actions regardless of who's viewing).
  const isStaffAdmin = isAdminStaff(session);
  let organizations: OrganizationOption[] = [];
  let numberingOnly = false;

  if (isStaffAdmin) {
    const { data } = await supabase
      .from("organizations")
      .select("id, name, engagement_mode, engagement_scope, itp_sequencing_mode")
      .order("name")
      .returns<OrganizationOption[]>();
    organizations = data ?? [];
  } else {
    const { data: grants } = await supabase
      .from("access_grants")
      .select("organizations(id, name, engagement_mode, engagement_scope, itp_sequencing_mode)")
      .eq("user_id", session.userId)
      .returns<{ organizations: OrganizationOption | null }[]>();

    const seen = new Set<string>();
    for (const g of grants ?? []) {
      const org = g.organizations;
      if (org && org.engagement_scope === "self_managed" && !seen.has(org.id)) {
        seen.add(org.id);
        organizations.push(org);
      }
    }
    if (organizations.length === 0) redirect("/inspect");
    numberingOnly = true;
  }

  const { org: orgIdParam } = await searchParams;
  const selectedOrg = organizations.find((o) => o.id === orgIdParam) ?? organizations[0] ?? null;

  let configsByDocType = new Map<string, NumberingConfigRow>();
  if (selectedOrg) {
    const { data: configs } = await supabase
      .from(NUMBERING_CONFIGS_TABLE)
      .select("*")
      .eq("organization_id", selectedOrg.id)
      .is("project_id", null)
      .returns<NumberingConfigRow[]>();

    configsByDocType = new Map((configs ?? []).map((c) => [c.doc_type, c]));
  }

  const reportPacks = selectedOrg && !numberingOnly ? await listMonthlyReportPacks(selectedOrg.id) : [];
  const weeklyReportPacks = selectedOrg && !numberingOnly ? await listWeeklyReportPacks(selectedOrg.id) : [];

  // R79 configurable ITP approval workflow: staff pool to pick a required reviewer/approver from —
  // JAGS staff aren't org-scoped (any staff login can be granted access to any org via access_grants,
  // same as the Staff Access screen), so this is the same global "every JAGS staff account" query
  // staff-access/page.tsx already uses, not filtered to this one org.
  let itpApprovalWorkflowConfig: ItpApprovalWorkflowConfigRow | null = null;
  let staffOptions: StaffOption[] = [];
  if (selectedOrg) {
    const [{ data: config }, { data: staff }] = await Promise.all([
      supabase
        .from(ITP_APPROVAL_WORKFLOW_CONFIGS_TABLE)
        .select("*")
        .eq("organization_id", selectedOrg.id)
        .maybeSingle<ItpApprovalWorkflowConfigRow>(),
      supabase
        .from("users")
        .select("id, full_name, email")
        .eq("is_jags_staff", true)
        .order("full_name")
        .returns<StaffOption[]>(),
    ]);
    itpApprovalWorkflowConfig = config ?? null;
    staffOptions = staff ?? [];
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-ink">
        {numberingOnly ? "Document numbering" : "Numbering & engagement mode"}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {numberingOnly
          ? "Configure how each document type is numbered for your organisation."
          : "One org-level engagement mode drives both branding and how every document type is numbered for that client."}
      </p>

      {!numberingOnly && (
        <OrgPickerForm organizations={organizations} selectedOrgId={selectedOrg?.id ?? null} />
      )}

      {selectedOrg && (
        <>
          {!numberingOnly && (
            <>
              <div className="mt-8 rounded-lg border border-border bg-surface p-4">
                <h2 className="text-sm font-semibold text-ink">Engagement mode</h2>
                <div className="mt-3">
                  <EngagementModeForm
                    organizationId={selectedOrg.id}
                    engagementMode={selectedOrg.engagement_mode}
                  />
                </div>
              </div>

              <div className="mt-8 rounded-lg border border-border bg-surface p-4">
                <h2 className="text-sm font-semibold text-ink">Engagement scope</h2>
                <div className="mt-3">
                  <EngagementScopeForm organizationId={selectedOrg.id} engagementScope={selectedOrg.engagement_scope} />
                </div>
              </div>

              <div className="mt-8 rounded-lg border border-border bg-surface p-4">
                <h2 className="text-sm font-semibold text-ink">Party sign-off sequencing (R67)</h2>
                <p className="mt-1 text-xs text-muted">
                  Controls whether non-blocking intervention levels (e.g. Witness, Review) must also
                  clear in sort_order, the same way blocking levels like Hold already do.
                </p>
                <div className="mt-4">
                  <ItpSequencingModeForm
                    organizationId={selectedOrg.id}
                    itpSequencingMode={selectedOrg.itp_sequencing_mode}
                  />
                </div>
              </div>
            </>
          )}

          <div className="mt-8 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Document numbering formats</h2>
            <p className="mt-1 text-xs text-muted">
              Org-wide defaults per document type. Leave a type unconfigured to use the default
              format: {"{project number}-JAGS-{TYPE}-{seq}"}.
            </p>
            <div className="mt-4">
              {NUMBERING_DOC_TYPES.map((docType) => {
                const config = configsByDocType.get(docType);
                return (
                  <NumberingConfigRowForm
                    key={docType}
                    organizationId={selectedOrg.id}
                    docType={docType}
                    config={
                      config
                        ? {
                            clientCode: config.client_code,
                            originatorCode: config.originator_code,
                            separator: config.separator,
                            sequencePadding: config.sequence_padding,
                            includeYear: config.include_year,
                            includeDiscipline: config.include_discipline,
                          }
                        : null
                    }
                  />
                );
              })}
            </div>
          </div>

          {!numberingOnly && (
            <>
              <div className="mt-8 rounded-lg border border-border bg-surface p-4">
                <h2 className="text-sm font-semibold text-ink">ITP approval workflow</h2>
                <p className="mt-1 text-xs text-muted">
                  By default, any JAGS staff login can submit an ITP for review or approve it once
                  under review (R79). Pin either step to one specific person if this
                  client&rsquo;s process requires a named reviewer or approver — leave a slot on
                  &ldquo;Unrestricted&rdquo; to keep today&rsquo;s behaviour. A JAGS Admin can always
                  act regardless of this setting.
                </p>
                <div className="mt-4">
                  <ItpApprovalWorkflowForm
                    organizationId={selectedOrg.id}
                    staff={staffOptions}
                    requiredReviewerUserId={itpApprovalWorkflowConfig?.required_reviewer_user_id ?? null}
                    requiredApproverUserId={itpApprovalWorkflowConfig?.required_approver_user_id ?? null}
                  />
                </div>
              </div>

              <div className="mt-8 rounded-lg border border-border bg-surface p-4">
                <h2 className="text-sm font-semibold text-ink">Monthly client report pack</h2>
                <p className="mt-1 text-xs text-muted">
                  Generates a PDF + CSV report pack (R109) covering this organisation&rsquo;s
                  first-time pass rate, inspections completed, NCR summary and ITP completion,
                  aggregated across all of their projects for the chosen month. Rendering happens
                  in the background — the table below updates automatically once it completes, no
                  reload needed.
                </p>
                <div className="mt-4">
                  <MonthlyReportPackForm organizationId={selectedOrg.id} initialPacks={reportPacks} aiConfigured={isAiConfigured()} />
                </div>
              </div>

              <div className="mt-8 rounded-lg border border-border bg-surface p-4">
                <h2 className="text-sm font-semibold text-ink">Weekly client report pack</h2>
                <p className="mt-1 text-xs text-muted">
                  The same PDF + CSV report pack, on a 7-day cadence instead of a calendar month —
                  covers first-time pass rate, inspections completed, NCR summary and ITP
                  completion for the chosen week, aggregated across all of this
                  organisation&rsquo;s projects. Rendering happens in the background — the table
                  below updates automatically once it completes, no reload needed.
                </p>
                <div className="mt-4">
                  <WeeklyReportPackForm organizationId={selectedOrg.id} initialPacks={weeklyReportPacks} />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
