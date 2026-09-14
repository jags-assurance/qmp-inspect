import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";

const VIEWS: { name: string; covers: string }[] = [
  { name: "vw_powerbi_inspections_completed_vs_planned", covers: "Inspections completed vs planned, per project" },
  { name: "vw_powerbi_itp_completion", covers: "ITP completion % (client-accepted / total), per project" },
  { name: "vw_powerbi_hold_point_turnaround", covers: "Average Hold-point turnaround hours (signoff-chain data only)" },
  { name: "vw_powerbi_first_time_pass_rate", covers: "First-time pass rate, per project" },
  { name: "vw_powerbi_ncr_trends", covers: "Monthly NCR volume and close-out time, by severity/status, per project" },
];

/**
 * Power BI is a direct-Postgres connection from Power BI Desktop, not an in-app screen — there is
 * nothing to click through in the product itself. That's exactly why it was previously invisible:
 * the setup steps only existed in docs/POWER_BI_CONNECTION.md in the repo, which no one running the
 * live app would ever see. This page is that same content, surfaced where an admin would actually
 * look for it. Admin-only, same boundary as Numbering and Staff Access — connecting Power BI at all
 * requires the powerbi_reader database credential, which is an account-administration concern.
 */
export default async function ReportingPage() {
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-ink">Power BI reporting</h1>
      <p className="mt-1 text-sm text-muted">
        JAGS-internal analytics — not an in-app page. Power BI Desktop connects directly to this
        project&apos;s Postgres database over a dedicated, read-only login, live or on a refresh
        schedule of your choosing. Clients never get this; they receive the monthly report pack
        instead (PDF + Excel, from Numbering &amp; engagement mode).
      </p>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium text-ink">The five reporting views</h2>
        <p className="mt-1 text-sm text-muted">
          Every view carries <code className="doc-id text-xs">organization_id</code> and{" "}
          <code className="doc-id text-xs">project_id</code> columns, so Power BI can slice by client
          and project once connected.
        </p>
        <ul className="mt-3 space-y-2">
          {VIEWS.map((v) => (
            <li key={v.name} className="rounded-md border border-border bg-off-white p-2.5 text-sm">
              <span className="doc-id text-ink">{v.name}</span>
              <span className="ml-2 text-muted">— {v.covers}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium text-ink">Connecting Power BI Desktop</h2>
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
          <li>In the Navigator, select only the five views above — that is all this role can see.</li>
        </ol>
      </div>

      <div className="mt-6 rounded-lg border border-warning/40 bg-warning/5 p-5">
        <h2 className="font-medium text-ink">Before sharing this with anyone</h2>
        <p className="mt-1 text-sm text-ink">
          The <code className="doc-id text-xs">powerbi_reader</code> password committed in the
          migration is a placeholder, not a real secret. Reset it once, from Supabase Dashboard →{" "}
          <strong>Database</strong> → <strong>Roles</strong>, before handing this connection to
          anyone — including your own team.
        </p>
        <p className="mt-2 text-sm text-ink">
          This role can only ever read the five views above — no other table, no writes. Isolation
          for who sees which client&apos;s data comes entirely from who is allowed to hold the{" "}
          <code className="doc-id text-xs">powerbi_reader</code> credential, not from row-level
          security (a plain database login has no Supabase Auth session for RLS to key off).
        </p>
      </div>
    </div>
  );
}
