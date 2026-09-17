import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NUMBERING_CONFIGS_TABLE, NUMBERING_DOC_TYPES, type NumberingConfigRow } from "@/lib/numbering/types";
import { listMonthlyReportPacks, listWeeklyReportPacks } from "@/lib/reports/actions";
import { EngagementModeForm } from "./engagement-mode-form";
import { NumberingConfigRow as NumberingConfigRowForm } from "./numbering-config-row";
import { OrgPickerForm } from "./org-picker-form";
import { MonthlyReportPackForm } from "./monthly-report-pack-form";
import { WeeklyReportPackForm } from "./weekly-report-pack-form";
import { REPORT_PACK_STATUS_LABEL } from "../../projects/[projectId]/reports/page";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface OrganizationOption {
  id: string;
  name: string;
  engagement_mode: string;
}

export default async function NumberingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const session = await requireSession();
  // Numbering/engagement-mode configuration is administrative (billing/branding scope) — Admin-only,
  // not a day-to-day Inspector task.
  if (!isAdminStaff(session)) redirect("/inspect");

  const { org: orgIdParam } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, name, engagement_mode")
    .order("name")
    .returns<OrganizationOption[]>();

  const selectedOrg = organizations?.find((o) => o.id === orgIdParam) ?? organizations?.[0] ?? null;

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

  const reportPacks = selectedOrg ? await listMonthlyReportPacks(selectedOrg.id) : [];
  const weeklyReportPacks = selectedOrg ? await listWeeklyReportPacks(selectedOrg.id) : [];

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-ink">Numbering & engagement mode</h1>
      <p className="mt-1 text-sm text-muted">
        One org-level engagement mode drives both branding and how every document type is numbered
        for that client.
      </p>

      <OrgPickerForm organizations={organizations ?? []} selectedOrgId={selectedOrg?.id ?? null} />

      {selectedOrg && (
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
                          }
                        : null
                    }
                  />
                );
              })}
            </div>
          </div>

          <div className="mt-8 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Monthly client report pack</h2>
            <p className="mt-1 text-xs text-muted">
              Generates a PDF + CSV report pack (R109) covering this organisation&rsquo;s first-time
              pass rate, inspections completed, NCR summary and ITP completion, aggregated across
              all of their projects for the chosen month. Rendering happens in the background;
              refresh this page to see it appear below once it completes.
            </p>
            <div className="mt-4">
              <MonthlyReportPackForm organizationId={selectedOrg.id} />
            </div>

            <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted">
              Generated report packs
            </h3>
            {reportPacks.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No report packs generated yet for this organisation.</p>
            ) : (
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted">
                    <th className="py-2">Period</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Requested</th>
                    <th className="py-2">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {reportPacks.map((pack) => (
                    <tr key={pack.id} className="border-b border-border last:border-0">
                      <td className="py-2">{MONTH_NAMES[pack.month - 1]} {pack.year}</td>
                      <td className="py-2">{REPORT_PACK_STATUS_LABEL[pack.status] ?? pack.status}</td>
                      <td className="py-2 text-xs text-muted">{new Date(pack.createdAt).toLocaleString()}</td>
                      <td className="py-2">
                        {pack.status === "completed" && pack.pdfUrl ? (
                          <span className="flex gap-3">
                            <a href={pack.pdfUrl} className="text-burgundy underline">PDF</a>
                            {pack.csvUrl && (
                              <a href={pack.csvUrl} className="text-burgundy underline">CSV</a>
                            )}
                          </span>
                        ) : pack.status === "failed" ? (
                          <span className="text-xs text-danger">{pack.errorMessage ?? "Failed"}</span>
                        ) : (
                          <span className="text-xs text-muted">Rendering…</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="mt-8 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Weekly client report pack</h2>
            <p className="mt-1 text-xs text-muted">
              The same PDF + CSV report pack, on a 7-day cadence instead of a calendar month —
              covers first-time pass rate, inspections completed, NCR summary and ITP completion
              for the chosen week, aggregated across all of this organisation&rsquo;s projects.
              Rendering happens in the background; refresh this page to see it appear below once it
              completes.
            </p>
            <div className="mt-4">
              <WeeklyReportPackForm organizationId={selectedOrg.id} />
            </div>

            <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted">
              Generated report packs
            </h3>
            {weeklyReportPacks.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No report packs generated yet for this organisation.</p>
            ) : (
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted">
                    <th className="py-2">Week</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Requested</th>
                    <th className="py-2">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyReportPacks.map((pack) => (
                    <tr key={pack.id} className="border-b border-border last:border-0">
                      <td className="py-2">Week of {pack.weekStart}</td>
                      <td className="py-2">{REPORT_PACK_STATUS_LABEL[pack.status] ?? pack.status}</td>
                      <td className="py-2 text-xs text-muted">{new Date(pack.createdAt).toLocaleString()}</td>
                      <td className="py-2">
                        {pack.status === "completed" && pack.pdfUrl ? (
                          <span className="flex gap-3">
                            <a href={pack.pdfUrl} className="text-burgundy underline">PDF</a>
                            {pack.csvUrl && (
                              <a href={pack.csvUrl} className="text-burgundy underline">CSV</a>
                            )}
                          </span>
                        ) : pack.status === "failed" ? (
                          <span className="text-xs text-danger">{pack.errorMessage ?? "Failed"}</span>
                        ) : (
                          <span className="text-xs text-muted">Rendering…</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
