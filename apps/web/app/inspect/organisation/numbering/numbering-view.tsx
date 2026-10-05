import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import { NUMBERING_CONFIGS_TABLE, NUMBERING_DOC_TYPES, type NumberingConfigRow } from "@/lib/numbering/types";
import {
  ITP_APPROVAL_WORKFLOW_CONFIGS_TABLE,
  type ItpApprovalWorkflowConfigRow,
} from "@/lib/itp-approval-workflow/types";
import { EngagementModeForm } from "./engagement-mode-form";
import { EngagementScopeForm } from "./engagement-scope-form";
import { ItpSequencingModeForm } from "./itp-sequencing-mode-form";
import { NumberingConfigRow as NumberingConfigRowForm } from "./numbering-config-row";
import { OrgPickerForm } from "./org-picker-form";
import { ItpApprovalWorkflowForm, type StaffOption } from "./itp-approval-workflow-form";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";

interface OrganizationOption {
  id: string;
  name: string;
  engagement_mode: string;
  engagement_scope: string;
  itp_sequencing_mode: string;
}

export async function NumberingSettingsView({ searchParams, embedded }: {
  searchParams: { org?: string };
  embedded?: boolean;
}) {
  const Heading = embedded ? "h2" : "h1";
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
      // Organisation-wide grants only — a project-scoped (contractor/party) grant must not unlock settings.
      .in("scope_type", ["organization", "global"])
      .returns<{ organizations: OrganizationOption | null }[]>();

    const seen = new Set<string>();
    for (const g of grants ?? []) {
      const org = g.organizations;
      if (org && (org.engagement_scope === "self_managed" || org.engagement_scope === "client_managed") && !seen.has(org.id)) {
        seen.add(org.id);
        organizations.push(org);
      }
    }
    if (organizations.length === 0) redirect("/inspect");
    numberingOnly = true;
  }

  const { org: orgIdParam } = searchParams;
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
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Heading className="text-2xl font-semibold text-ink">
          {numberingOnly ? "Document numbering" : "Numbering & engagement mode"}
        </Heading>
        <PageGuide
          title={`${numberingOnly ? "Document numbering" : "Numbering & engagement mode"} — how this works`}
          points={
            numberingOnly
              ? [
                  "Self-Managed and Full Client-Managed clients can configure their own organisation's document numbering format directly — this is the same page a JAGS Admin uses, scoped to just your org and with only the numbering section shown.",
                  "Engagement mode/scope, sign-off sequencing, ITP approval workflow and report packs stay JAGS-Admin-only actions regardless of who's viewing.",
                  "Leave a document type unconfigured to use the default format: {project number}-JAGS-{TYPE}-{seq}.",
                ]
              : [
                  "Admin-only. One org-level engagement mode drives both branding and how every document type is numbered for that client.",
                  "A Self-Managed or Full Client-Managed client can configure their own org's numbering directly (this same page, scoped to their org) — engagement mode/scope, sign-off sequencing, ITP approval workflow and report packs stay Admin-only regardless.",
                  "Party sign-off sequencing controls whether non-blocking intervention levels (e.g. Witness, Review) must also clear in sort_order, the same way blocking levels like Hold already do.",
                  "ITP approval workflow: by default any JAGS staff login can submit/approve an ITP; pin a slot to one specific reviewer/approver if the client's process requires a named person. A JAGS Admin can always act regardless of this setting.",
                  "Monthly/weekly client report packs moved to Reporting (Insights & Usage) — this page now covers numbering/engagement/workflow only.",
                ]
          }
        />
      </div>
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

              <p className="mt-8 text-sm text-muted">
                Looking for monthly/weekly client report packs? They moved to{" "}
                <Link href={`/inspect/organisation/reporting?org=${selectedOrg.id}`} className="text-burgundy hover:underline">
                  Reporting
                </Link>{" "}
                (under Insights &amp; Usage) — same organisation, one click away.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
