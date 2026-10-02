import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listMonthlyReportPacks, listWeeklyReportPacks } from "@/lib/reports/actions";
import { isAiConfigured } from "@/lib/ai/gate";
import { OrgPickerForm } from "../numbering/org-picker-form";
import { MonthlyReportPackForm } from "../numbering/monthly-report-pack-form";
import { WeeklyReportPackForm } from "../numbering/weekly-report-pack-form";
import { PageGuide } from "@/components/domain/page-guide";

const VIEWS: { name: string; covers: string }[] = [
  { name: "vw_powerbi_inspections_completed_vs_planned", covers: "Inspections completed vs planned, per project" },
  { name: "vw_powerbi_itp_completion", covers: "ITP completion % (client-accepted / total), per project" },
  { name: "vw_powerbi_hold_point_turnaround", covers: "Average Hold-point turnaround hours (signoff-chain data only)" },
  { name: "vw_powerbi_first_time_pass_rate", covers: "First-time pass rate, per project" },
  { name: "vw_powerbi_ncr_trends", covers: "Monthly NCR volume and close-out time, by severity/status, per project" },
  { name: "vw_powerbi_punch_list_and_fat", covers: "Open/closed punch-list item counts and standalone FAT pass/conditional/fail counts, per project" },
];

interface OrganizationOption {
  id: string;
  name: string;
}

/**
 * Two unrelated but both-"reporting" things live on this one page, grouped here rather than
 * scattered because that's exactly what the sidebar nav group ("Insights & Usage") already implies:
 *
 * 1. Client report packs — moved here from Numbering & engagement mode, where they were a real
 *    misplacement: generating a client-facing PDF/CSV pack has nothing to do with document-numbering
 *    formats, and belongs with this page's own "Reporting" identity instead.
 * 2. Power BI — JAGS-internal analytics, unrelated to any one organisation, so it stays visible
 *    regardless of which org is selected above.
 *
 * Admin-only, same boundary as Numbering and Staff Access.
 */
export async function ReportingView({ searchParams, embedded }: {
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
  const selectedOrg = (organizations ?? []).find((o) => o.id === orgIdParam) ?? organizations?.[0] ?? null;

  const [reportPacks, weeklyReportPacks] = selectedOrg
    ? await Promise.all([listMonthlyReportPacks(selectedOrg.id), listWeeklyReportPacks(selectedOrg.id)])
    : [[], []];

  return (
    <div className={embedded ? undefined : "max-w-3xl"}>
      {!embedded && (
<Link href="/inspect" className="text-sm text-burgundy hover:underline">
        ← Back to Dashboard
      </Link>
)}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Heading className="text-2xl font-semibold text-ink">Reporting</Heading>
        <PageGuide
          title="Reporting — how this works"
          points={[
            "Client report packs (below) generate a PDF + CSV for one organisation, aggregated across all of its projects — rendered in the background, the table updates automatically once done.",
            "Power BI (further down) is separate and JAGS-internal only — clients never get Power BI access; they receive the report packs above instead.",
            "This is JAGS-internal analytics + client-facing report generation, both Admin-only, same boundary as Numbering and Staff Access.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        Generate client-facing report packs for one organisation, or connect Power BI for JAGS-internal analytics.
      </p>

      <OrgPickerForm organizations={organizations ?? []} selectedOrgId={selectedOrg?.id ?? null} />

      {selectedOrg && (
        <>
          <div className="mt-8 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Monthly client report pack</h2>
            <p className="mt-1 text-xs text-muted">
              Generates a PDF + CSV report pack (R109) covering {selectedOrg.name}&rsquo;s
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
              completion for the chosen week, aggregated across all of {selectedOrg.name}&rsquo;s
              projects. Rendering happens in the background — the table below updates
              automatically once it completes, no reload needed.
            </p>
            <div className="mt-4">
              <WeeklyReportPackForm organizationId={selectedOrg.id} initialPacks={weeklyReportPacks} />
            </div>
          </div>
        </>
      )}

      <div className="mt-10 border-t border-border pt-8">
        <h2 className="text-lg font-semibold text-ink">Power BI (JAGS-internal analytics)</h2>
        <p className="mt-1 text-sm text-muted">
          Not an in-app page. Power BI Desktop connects directly to this project&apos;s Postgres
          database over a dedicated, read-only login, live or on a refresh schedule of your
          choosing — unrelated to any one organisation, so it stays visible regardless of the org
          picked above.
        </p>

        <div className="mt-6 rounded-lg border border-border bg-surface p-5">
          <h3 className="font-medium text-ink">The six reporting views</h3>
          <p className="mt-1 text-sm text-muted">
            Every view carries <code className="doc-id text-xs">organization_id</code> and{" "}
            <code className="doc-id text-xs">project_id</code> columns, so Power BI can slice by client
            and project once connected.
          </p>
          <ul className="mt-3 space-y-2">
            {VIEWS.map((v) => (
              <li key={v.name} className="rounded-md border border-border bg-off-white p-2.5 text-sm">
                <span className="doc-id text-ink [overflow-wrap:anywhere]">{v.name}</span>
                <span className="ml-2 text-muted">— {v.covers}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 rounded-lg border border-border bg-surface p-5">
          <h3 className="font-medium text-ink">Connecting Power BI Desktop</h3>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink">
            <li>Power BI Desktop → <strong>Get Data</strong> → <strong>Database</strong> → <strong>PostgreSQL database</strong>.</li>
            <li>
              Server and database come from Supabase Dashboard → <strong>Project Settings</strong> →{" "}
              <strong>Database</strong> → Connection info.
            </li>
            <li>
              Data Connectivity mode: <strong>DirectQuery</strong> for a live connection with no manual
              refresh — the intended mode. <strong>Import</strong> is a fallback if DirectQuery&apos;s
              SQL limitations become a problem for a specific report.
            </li>
            <li>
              Credentials: <strong>Database</strong> authentication, user{" "}
              <code className="doc-id text-xs">powerbi_reader</code>, password from wherever your team
              keeps it — never the placeholder committed in the migration file.
            </li>
            <li>In the Navigator, select only the six views above — that is all this role can see.</li>
          </ol>
        </div>

        <div className="mt-6 rounded-lg border border-border bg-surface p-5">
          <h3 className="font-medium text-ink">Sharing it on the web (Power BI Service)</h3>
          <p className="mt-1 text-sm text-muted">
            Desktop and the Power BI Service (app.powerbi.com) are two different things — connecting in
            Desktop above does not by itself put anything on the web. To share a report with colleagues
            who don&apos;t have Desktop:
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink">
            <li>Build the report in Desktop (above), then <strong>Publish</strong> it to your workspace in the Power BI Service.</li>
            <li>
              Supabase&apos;s Postgres isn&apos;t one of Power BI&apos;s pre-approved cloud data sources, so the Service
              can&apos;t reach it directly — you need an{" "}
              <strong>On-premises Data Gateway</strong> (despite the name, it also brokers a cloud database like this
              one). Install it on any always-on machine your team controls, register it under your Power BI tenant,
              then map the <code className="doc-id text-xs">powerbi_reader</code> data source to it in the Service&apos;s
              dataset settings.
            </li>
            <li>
              Without the gateway, a <strong>DirectQuery</strong> report simply won&apos;t load once viewed in the
              browser, and an <strong>Import</strong> report will publish fine but can never refresh on a schedule —
              it stays frozen at whatever data was in Desktop when you published.
            </li>
          </ol>
        </div>

        <div className="mt-6 rounded-lg border border-warning/40 bg-warning/5 p-5">
          <h3 className="font-medium text-ink">Before sharing this with anyone</h3>
          <p className="mt-1 text-sm text-ink">
            The <code className="doc-id text-xs">powerbi_reader</code> password committed in the
            migration is a placeholder, not a real secret. Reset it once, from Supabase Dashboard →{" "}
            <strong>Database</strong> → <strong>Roles</strong>, before handing this connection to
            anyone — including your own team.
          </p>
          <p className="mt-2 text-sm text-ink">
            This role can only ever read the six views above — no other table, no writes. Isolation
            for who sees which client&apos;s data comes entirely from who is allowed to hold the{" "}
            <code className="doc-id text-xs">powerbi_reader</code> credential, not from row-level
            security (a plain database login has no Supabase Auth session for RLS to key off).
          </p>
        </div>
      </div>
    </div>
  );
}
