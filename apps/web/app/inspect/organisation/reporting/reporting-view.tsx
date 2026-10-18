import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listMonthlyReportPacks, listWeeklyReportPacks } from "@/lib/reports/actions";
import { isAiEnabledForOrg } from "@/lib/ai/gate";
import { OrgPickerForm } from "../numbering/org-picker-form";
import { MonthlyReportPackForm } from "../numbering/monthly-report-pack-form";
import { WeeklyReportPackForm } from "../numbering/weekly-report-pack-form";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { T } from "@/components/domain/t";
import { MoreDetails } from "@/components/domain/more-details";
import { getTranslator } from "@/lib/i18n/server";

const VIEWS: { name: string; covers: string }[] = [
  { name: "vw_powerbi_inspections_completed_vs_planned", covers: "Inspections completed vs planned, per project" },
  { name: "vw_powerbi_itp_completion", covers: "ITP completion % (client-accepted / total), per project" },
  { name: "vw_powerbi_hold_point_turnaround", covers: "Average Hold-point turnaround hours (signoff-chain data only)" },
  { name: "vw_powerbi_first_time_pass_rate", covers: "First-time pass rate, per project" },
  { name: "vw_powerbi_ncr_trends", covers: "Monthly NCR volume and close-out time, by severity/status, per project" },
  { name: "vw_powerbi_punch_list_and_fat", covers: "Open/closed punch-list item counts and standalone FAT pass/conditional/fail counts, per project" },
  { name: "vw_powerbi_inspection_attempts", covers: "Every inspection attempt (A, B, C...) with the activity, inspector and date, whether it was a re-inspection, and how many days a failed attempt took to pass" },
  { name: "vw_powerbi_signoff_turnaround", covers: "Every Hold/Witness/Review/Surveillance sign-off with who was notified, when, and how many hours they took to respond (signed off vs proceeded without response kept separate)" },
  { name: "vw_powerbi_databook_completeness", covers: "How ready each project's Data Book is: ready vs required per category, overall percentage, open punch items" },
  { name: "vw_powerbi_activity_fact", covers: "One flat row per ITP activity (project, ITP, section, discipline, parties, sign-offs, latest inspection result, attempts, evidence) so one report can slice everything by activity" },
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
  const tl = await getTranslator();
  const Heading = embedded ? "h2" : "h1";
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect?denied=1");

  const supabase = await createSupabaseServerClient();
  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, name")
    .order("name")
    .returns<OrganizationOption[]>();

  const { org: orgIdParam } = searchParams;
  const selectedOrg = (organizations ?? []).find((o) => o.id === orgIdParam) ?? organizations?.[0] ?? null;

  const { data: orgProjects } = selectedOrg
    ? await supabase.from("projects").select("id, name").eq("organization_id", selectedOrg.id).order("name").returns<{ id: string; name: string }[]>()
    : { data: [] as { id: string; name: string }[] };
  const [reportPacks, weeklyReportPacks] = selectedOrg
    ? await Promise.all([listMonthlyReportPacks(selectedOrg.id), listWeeklyReportPacks(selectedOrg.id)])
    : [[], []];

  return (
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Heading className={embedded ? "text-lg font-semibold text-text-strong" : "text-2xl font-semibold tracking-tight text-text-strong sm:text-[1.75rem]"}><T>Reporting</T></Heading>
        <PageGuide
          title={tl("Reporting — how this works")}
          points={[
            "Client report packs (below) generate a PDF + CSV for one organisation, aggregated across all of its projects — rendered in the background, the table updates automatically once done.",
            "Power BI (further down) is separate and JAGS-internal only — clients never get Power BI access; they receive the report packs above instead.",
            "This is JAGS-internal analytics + client-facing report generation, both Admin-only, same boundary as Numbering and Staff Access.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        <T>Generate client-facing report packs for one organisation, or connect Power BI for JAGS-internal analytics.</T>
      </p>

      <OrgPickerForm organizations={organizations ?? []} selectedOrgId={selectedOrg?.id ?? null} />

      {selectedOrg && (
        <>
          <div className="mt-8 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
            <h2 className="text-sm font-semibold text-ink"><T>Monthly client report pack</T></h2>
            <MoreDetails className="mt-1"><p>
              <T>Generates a PDF + CSV report pack (R109) covering</T> {selectedOrg.name}<T>&rsquo;s first-time pass rate, inspections completed, NCR summary and ITP completion, aggregated across all of their projects (or the one project you choose) for the chosen month. Rendering happens in the background — the table below updates automatically once it completes, no reload needed.</T>
            </p></MoreDetails>
            <div className="mt-4">
              <MonthlyReportPackForm organizationId={selectedOrg.id} initialPacks={reportPacks} aiConfigured={await isAiEnabledForOrg(supabase, selectedOrg.id)} projects={orgProjects ?? []} />
            </div>
          </div>

          <div className="mt-8 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
            <h2 className="text-sm font-semibold text-ink"><T>Weekly client report pack</T></h2>
            <MoreDetails className="mt-1"><p>
              <T>The same PDF + CSV report pack, on a 7-day cadence instead of a calendar month — covers first-time pass rate, inspections completed, NCR summary and ITP completion for the chosen week, aggregated across all of</T> {selectedOrg.name}<T>&rsquo;s projects. Rendering happens in the background — the table below updates automatically once it completes, no reload needed.</T>
            </p></MoreDetails>
            <div className="mt-4">
              <WeeklyReportPackForm organizationId={selectedOrg.id} initialPacks={weeklyReportPacks} projects={orgProjects ?? []} />
            </div>
          </div>
        </>
      )}

      <div className="mt-10 border-t border-border pt-8">
        <h2 className="text-lg font-semibold text-ink"><T>Power BI (JAGS-internal analytics)</T></h2>
        <p className="mt-1 text-sm text-muted">
          <T>Connect Power BI to the read-only reporting views.</T>
        </p>
        <MoreDetails label="Setup steps" bare className="mt-2">
        <p className="text-sm text-muted">
          <T>Not an in-app page. Power BI Desktop connects directly to this project&apos;s Postgres database over a dedicated, read-only login, live or on a refresh schedule of your choosing — unrelated to any one organisation, so it stays visible regardless of the org picked above.</T>
        </p>

        <div className="mt-6 rounded-lg border border-border bg-surface p-5">
          <h3 className="font-medium text-ink"><T>The ten reporting views</T></h3>
          <p className="mt-1 text-sm text-muted">
            <T>Every view carries</T> <code className="doc-id text-xs"><T>organization_id</T></code> <T>and</T>{" "}
            <code className="doc-id text-xs"><T>project_id</T></code> <T>columns, so Power BI can slice by client and project once connected.</T>
          </p>
          <ul className="mt-3 space-y-2">
            {VIEWS.map((v) => (
              <li key={v.name} className="rounded-md border border-border bg-off-white p-2.5 text-sm">
                <span className="doc-id text-ink [overflow-wrap:anywhere]">{v.name}</span>
                <span className="ms-2 text-muted">— {v.covers}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 rounded-lg border border-border bg-surface p-5">
          <h3 className="font-medium text-ink"><T>Connecting Power BI Desktop</T></h3>
          <ol className="mt-3 list-decimal space-y-2 ps-5 text-sm text-ink">
            <li><T>Power BI Desktop →</T> <strong><T>Get Data</T></strong> → <strong><T>Database</T></strong> → <strong><T>PostgreSQL database</T></strong>.</li>
            <li>
              <T>Server and database come from Supabase Dashboard →</T> <strong><T>Project Settings</T></strong> →{" "}
              <strong><T>Database</T></strong> <T>→ Connection info.</T>
            </li>
            <li>
              <T>Data Connectivity mode:</T> <strong><T>DirectQuery</T></strong> <T>for a live connection with no manual refresh — the intended mode.</T> <strong><T>Import</T></strong> <T>is a fallback if DirectQuery&apos;s SQL limitations become a problem for a specific report.</T>
            </li>
            <li>
              <T>Credentials:</T> <strong><T>Database</T></strong> <T>authentication, user</T>{" "}
              <code className="doc-id text-xs"><T>powerbi_reader</T></code><T>, password from wherever your team keeps it — never the placeholder committed in the migration file.</T>
            </li>
            <li><T>In the Navigator, select only the ten views above — that is all this role can see.</T></li>
          </ol>
        </div>

        <div className="mt-6 rounded-lg border border-border bg-surface p-5">
          <h3 className="font-medium text-ink"><T>Sharing it on the web (Power BI Service)</T></h3>
          <p className="mt-1 text-sm text-muted">
            <T>Desktop and the Power BI Service (app.powerbi.com) are two different things — connecting in Desktop above does not by itself put anything on the web. To share a report with colleagues who don&apos;t have Desktop:</T>
          </p>
          <ol className="mt-3 list-decimal space-y-2 ps-5 text-sm text-ink">
            <li><T>Build the report in Desktop (above), then</T> <strong><T>Publish</T></strong> <T>it to your workspace in the Power BI Service.</T></li>
            <li>
              <T>Supabase&apos;s Postgres isn&apos;t one of Power BI&apos;s pre-approved cloud data sources, so the Service can&apos;t reach it directly — you need an</T>{" "}
              <strong><T>On-premises Data Gateway</T></strong> <T>(despite the name, it also brokers a cloud database like this one). Install it on any always-on machine your team controls, register it under your Power BI tenant, then map the</T> <code className="doc-id text-xs"><T>powerbi_reader</T></code> <T>data source to it in the Service&apos;s dataset settings.</T>
            </li>
            <li>
              <T>Without the gateway, a</T> <strong><T>DirectQuery</T></strong> <T>report simply won&apos;t load once viewed in the browser, and an</T> <strong><T>Import</T></strong> <T>report will publish fine but can never refresh on a schedule — it stays frozen at whatever data was in Desktop when you published.</T>
            </li>
          </ol>
        </div>

        <div className="mt-6 rounded-lg border border-warning/40 bg-warning/5 p-5">
          <h3 className="font-medium text-ink"><T>Before sharing this with anyone</T></h3>
          <p className="mt-1 text-sm text-ink">
            <T>The</T> <code className="doc-id text-xs"><T>powerbi_reader</T></code> <T>password committed in the migration is a placeholder, not a real secret. Reset it once, from Supabase Dashboard →</T>{" "}
            <strong><T>Database</T></strong> → <strong><T>Roles</T></strong><T>, before handing this connection to anyone — including your own team.</T>
          </p>
          <p className="mt-2 text-sm text-ink">
            <T>This role can only ever read the ten views above — no other table, no writes. Isolation for who sees which client&apos;s data comes entirely from who is allowed to hold the</T>{" "}
            <code className="doc-id text-xs"><T>powerbi_reader</T></code> <T>credential, not from row-level security (a plain database login has no Supabase Auth session for RLS to key off).</T>
          </p>
        </div>
        </MoreDetails>
      </div>
    </div>
  );
}
