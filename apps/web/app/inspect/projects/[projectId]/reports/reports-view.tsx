import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { listMonthlyReportPacks } from "@/lib/reports/actions";
import { REPORT_PACK_STATUS_LABEL } from "@/lib/reports/status-labels";
import { isModuleLicensed } from "@/lib/module-licensing/access";
import { HANDOVER_CERTIFICATES_TABLE } from "@/lib/databook/types";
import { PageGuide } from "@/components/domain/page-guide";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

interface HandoverAttentionRow {
  id: string;
  certificate_number: string;
  acknowledged_at: string | null;
  data_books: { book_number: string; title: string } | null;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ITP_STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "gold"> = {
  draft: "neutral",
  under_review: "warning",
  approved: "gold",
  client_accepted: "success",
};

const ITP_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  under_review: "Under review",
  approved: "Approved",
  client_accepted: "Client accepted",
};

interface ProjectSummary {
  id: string;
  project_number: string;
  name: string;
  organization_id: string;
  organizations: { name: string } | null;
}

interface ItpSummary {
  id: string;
  itp_number: string;
  title: string;
  status: string;
}

/**
 * Client-facing view/download of what has already been generated for this project's organisation
 * — the monthly report packs (PDF + Excel) built by generateMonthlyReportPackAction, plus a link to
 * each ITP's own page where its PDF button already lives. This is deliberately display-only:
 * generating a new pack stays staff-only on apps/web/app/inspect/organisation/reporting's sibling
 * (apps/web/app/inspect/organisation/numbering/page.tsx). Reachable by any role with access to the
 * project — no isAdminStaff gate — same access pattern as the project hub
 * (apps/web/app/inspect/projects/[projectId]/page.tsx): requireSession() plus an RLS-scoped query,
 * notFound() if the project isn't visible to this user.
 */
export async function ReportsView({ projectId, embedded = false }: { projectId: string; embedded?: boolean }) {
  const tl = await getTranslator();
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_number, name, organization_id, organizations(name)")
    .eq("id", projectId)
    .maybeSingle<ProjectSummary>();

  if (!project) notFound();

  // R112 module licensing (page-level, not layout-level): this page's organisation is the
  // PROJECT's org, not necessarily whichever org happens to be this session's own grant — a
  // subcontractor/TPI can view reports across several client orgs' projects, so there's no single
  // org to gate at app/inspect/layout.tsx. JAGS staff always bypass (support needs full visibility).
  if (!session.isJagsStaff && !(await isModuleLicensed(supabase, project.organization_id, "reporting"))) {
    redirect(`/inspect/projects/${projectId}`);
  }

  const [reportPacks, { data: itps }, { data: handoverAttentionRows }] = await Promise.all([
    listMonthlyReportPacks(project.organization_id),
    supabase
      .from("itps")
      .select("id, itp_number, title, status")
      .eq("project_id", projectId)
      .order("itp_number")
      .returns<ItpSummary[]>(),
    // "Needs attention" — a handover certificate missing its package file (a pre-fix legacy row;
    // issuing one without a package is blocked server-side now, see issueHandoverAction) is
    // otherwise only ever surfaced on the client-facing Handover Portal — merged onto this hub too
    // (plan Phase 9) so staff/anyone reviewing this project's reports sees it without a separate
    // destination.
    supabase
      .from(HANDOVER_CERTIFICATES_TABLE)
      .select("id, certificate_number, acknowledged_at, package_storage_path, data_books!inner(project_id, book_number, title)")
      .eq("data_books.project_id", projectId)
      .is("package_storage_path", null)
      .returns<(HandoverAttentionRow & { package_storage_path: string | null })[]>(),
  ]);

  const Heading = embedded ? "h2" : "h1";
  const packColumns: ResponsiveColumn<(typeof reportPacks)[number]>[] = [
    { key: "period", header: "Period", render: (pack) => `${MONTH_NAMES[pack.month - 1]} ${pack.year}` },
    { key: "status", header: "Status", render: (pack) => REPORT_PACK_STATUS_LABEL[pack.status] ?? pack.status },
    {
      key: "generated",
      header: "Generated",
      className: "text-xs text-muted",
      render: (pack) => (pack.completedAt ? new Date(pack.completedAt).toLocaleString("en-GB") : "—"),
    },
    {
      key: "download",
      header: "Download",
      render: (pack) =>
        pack.status === "completed" && pack.pdfUrl ? (
          <span className="flex gap-3">
            <a href={pack.pdfUrl} className="text-burgundy underline"><T>PDF</T></a>
            {pack.xlsxUrl && <a href={pack.xlsxUrl} className="text-burgundy underline"><T>Excel</T></a>}
          </span>
        ) : pack.status === "failed" ? (
          <span className="text-xs text-danger">{pack.errorMessage ?? "Failed"}</span>
        ) : (
          <span className="text-xs text-muted"><T>Preparing…</T></span>
        ),
    },
  ];

  return (
    <div>
      {!embedded && (
        <Link href={`/inspect/projects/${projectId}`} className="text-sm text-burgundy hover:underline">
          <T>← Back to Project</T>
        </Link>
      )}
      <div className="mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="text-2xl font-semibold text-ink"><T>Reports</T></Heading>
          <PageGuide
            title={tl("Reports & Downloads — how this works")}
            points={[
              "Display and download only — generating a new monthly report pack stays staff-only, done from the Reporting admin page, not from here.",
              "Reachable by any role with access to this project, since a subcontractor or TPI/lab can have reports across several client organisations' projects — no single org to scope a layout-level gate to.",
              "This page requires the project's organisation to be licensed for the Reporting module (JAGS staff always bypass) — otherwise it redirects back to the project hub.",
              "Each ITP's own controlled A4 PDF lives on that ITP's own page, linked from the \"ITP documents\" list below.",
            ]}
          />
        </div>
        <p className="mt-1 text-sm text-muted">
          {project.organizations?.name ?? "—"} · <span className="doc-id">{project.project_number}</span> {project.name}
        </p>
      </div>

      {(handoverAttentionRows ?? []).length > 0 && (
        <div className="mt-8 rounded-lg border-2 border-warning bg-warning/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium text-ink"><T>Needs attention — Handover</T></h2>
            <Badge tone="warning">{(handoverAttentionRows ?? []).length} <T>open</T></Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            <T>No package file attached; the client sees a warning instead of a download.</T>
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {(handoverAttentionRows ?? []).map((cert) => (
              <li key={cert.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2">
                <span>
                  <span className="doc-id text-burgundy">{cert.certificate_number}</span>
                  <span className="ms-2 text-muted">
                    {cert.data_books?.book_number} — {cert.data_books?.title}
                  </span>
                </span>
                <span className="text-xs text-muted">
                  {cert.acknowledged_at ? "Already acknowledged by the client" : "Not yet acknowledged"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            <T>Resolved from the project&rsquo;s</T>{" "}
            <Link href={`/inspect/projects/${projectId}/data-book`} className="text-burgundy hover:underline">
              <T>Data Book</T>
            </Link>{" "}
            <T>page, where the Data Book this certificate belongs to can be re-compiled and its package uploaded.</T>
          </p>
        </div>
      )}

      <div className="mt-8 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium text-ink"><T>Monthly report packs</T></h2>
        <p className="mt-1 text-sm text-muted">
          <T>Monthly PDF and Excel summaries.</T>
        </p>

        {reportPacks.length === 0 ? (
          <p className="mt-4 text-sm text-muted"><T>No report packs have been generated for your organisation yet.</T></p>
        ) : (
          <div className="mt-4">
            <ResponsiveTable
              columns={packColumns}
              rows={reportPacks}
              rowKey={(pack) => pack.id}
              caption="Monthly report packs"
              headRowClassName="border-b border-border text-start text-xs uppercase text-muted"
              thClassName="py-2"
              tdClassName="py-2"
            />
          </div>
        )}
      </div>

      <div className="mt-8 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium text-ink"><T>ITP documents</T></h2>
        <p className="mt-1 text-sm text-muted">
          <T>Each ITP has its own PDF on its page.</T>
        </p>

        {(itps ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted"><T>No ITPs recorded for this project yet.</T></p>
        ) : (
          <ul className="mt-4 space-y-2">
            {(itps ?? []).map((itp) => (
              <li
                key={itp.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>
                  <Link href={`/inspect/itps/${itp.id}`} className="doc-id text-burgundy hover:underline">
                    {itp.itp_number}
                  </Link>
                  <span className="ms-2 text-ink">{itp.title}</span>
                </span>
                <span className="flex items-center gap-3">
                  <Badge tone={ITP_STATUS_TONE[itp.status] ?? "neutral"}>
                    {ITP_STATUS_LABEL[itp.status] ?? itp.status}
                  </Badge>
                  <Link href={`/inspect/itps/${itp.id}`} className="text-burgundy underline">
                    <T>View / Download</T>
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

