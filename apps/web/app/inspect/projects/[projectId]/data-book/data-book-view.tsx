import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { isModuleLicensed } from "@/lib/module-licensing/access";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { cn } from "@/lib/cn";
import { computeDataBookReadiness } from "@/lib/databook/readiness";
import { computeDataBookDisciplineBreakdown } from "@/lib/databook/discipline-breakdown";
import { DATA_BOOKS_TABLE, HANDOVER_CERTIFICATES_TABLE, type DataBookRow, type DataBookStatus } from "@/lib/databook/types";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { NCRS_TABLE, type NcrSeverity } from "@/lib/ncrs/types";
import { getLatestDataBookPdf } from "@/lib/reports/actions";
import { ReadinessPanel } from "./readiness-panel";
import { DisciplineBreakdownPanel } from "./discipline-breakdown-panel";
import { CreateDataBookForm } from "./create-databook-form";
import { CompileDataBookForm, type OpenPunchItemPreview } from "./compile-databook-form";
import { IssueHandoverForm } from "./issue-handover-form";
import { DataBookPdfButton } from "./data-book-pdf-button";
import { DataBookStructurePanel } from "./structure-panel";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { PageGuide } from "@/components/domain/page-guide";

const STATUS_TONE: Record<DataBookStatus, "neutral" | "warning" | "success"> = {
  draft: "neutral",
  compiled: "warning",
  issued: "success",
};

const STATUS_LABEL: Record<DataBookStatus, string> = {
  draft: "Draft",
  compiled: "Compiled",
  issued: "Issued",
};

const PARTY_TYPE_LABEL: Record<string, string> = {
  client: "Client",
  main_contractor: "Main Contractor",
  subcontractor: "Subcontractor",
  tpi_lab: "TPI / Lab",
  vendor: "Vendor",
  jags: "JAGS Assurance",
};

const NCR_SEVERITY_LABEL: Record<NcrSeverity, string> = {
  observation: "Observation",
  minor_ncr: "Minor",
  major_ncr: "Major",
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("en-GB") : "—";
}

export async function DataBookView({ projectId, embedded = false }: { projectId: string; embedded?: boolean }) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, site_location, country, start_date, end_date, organization_id, organizations(name)")
    .eq("id", projectId)
    .maybeSingle<{
      id: string;
      name: string;
      project_number: string;
      site_location: string | null;
      country: string | null;
      start_date: string | null;
      end_date: string | null;
      organization_id: string;
      organizations: { name: string } | null;
    }>();

  if (!project) notFound();

  // R112 module licensing (page-level — see reports/page.tsx's doc comment for why: no single org
  // to gate at the shared /inspect layout). JAGS staff always bypass.
  if (!session.isJagsStaff && !(await isModuleLicensed(supabase, project.organization_id, "data_book"))) {
    redirect(`/inspect/projects/${projectId}`);
  }

  const [
    readiness,
    disciplineBreakdown,
    { data: dataBooks },
    { data: openPunchItemRows },
    { data: parties },
    { data: ncrs },
    { data: punchItems },
  ] = await Promise.all([
    computeDataBookReadiness(projectId),
    computeDataBookDisciplineBreakdown(projectId),
    supabase
      .from(DATA_BOOKS_TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .returns<DataBookRow[]>(),
    // Shown inline in the override section of CompileDataBookForm so a Conditional Handover is
    // reviewed item-by-item before committing to it, not just a blind "I know some are open" tick.
    supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id, description, location, due_date, project_parties(name)")
      .eq("project_id", projectId)
      .neq("status", "closed")
      .returns<OpenPunchItemPreview[]>(),
    // Project parties — same source apps/inspect/projects/[projectId]/page.tsx uses — surfaced here
    // so a Data Book reads like a real completion dossier ("who was involved"), not just a readiness
    // meter with no project context.
    supabase
      .from("project_parties")
      .select("id, name, party_type, is_active")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .order("party_type")
      .returns<{ id: string; name: string; party_type: string; is_active: boolean }[]>(),
    supabase
      .from(NCRS_TABLE)
      .select("id, severity, status")
      .eq("project_id", projectId)
      .returns<{ id: string; severity: NcrSeverity; status: string }[]>(),
    supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id, status")
      .eq("project_id", projectId)
      .returns<{ id: string; status: string }[]>(),
  ]);

  const openPunchItems: OpenPunchItemPreview[] = openPunchItemRows ?? [];

  const dataBookPdfStatuses = await Promise.all(
    (dataBooks ?? []).map((book) => getLatestDataBookPdf(book.id))
  );

  // Chain-of-custody trail (draft → compiled → issued → client acknowledged) per data book — the
  // handover_certificates row is the source of truth for the "issued"/"acknowledged" steps, same
  // table lib/handover/actions.ts writes to.
  const dataBookCertificates = await Promise.all(
    (dataBooks ?? []).map((book) =>
      book.status === "issued"
        ? supabase
            .from(HANDOVER_CERTIFICATES_TABLE)
            .select("id, certificate_number, issued_date, issued_by, received_by_name, received_by_company, acknowledged_at, is_conditional")
            .eq("data_book_id", book.id)
            .maybeSingle<{
              id: string;
              certificate_number: string;
              issued_date: string;
              issued_by: string | null;
              received_by_name: string | null;
              received_by_company: string | null;
              acknowledged_at: string | null;
              is_conditional: boolean;
            }>()
            .then((r) => r.data)
        : Promise.resolve(null)
    )
  );

  // What was actually done, by severity/status — real counts pulled together here rather than
  // fabricated, so the page answers "what was done" at a glance the way the PDF's own summary does.
  const ncrRows = ncrs ?? [];
  // Observations are advisory, not nonconformances — excluded from the closed-out count (matches readiness).
  const countedNcrs = ncrRows.filter((n) => n.severity !== "observation");
  const ncrTotal = countedNcrs.length;
  const ncrClosed = countedNcrs.filter((n) => n.status === "closed").length;
  const ncrBySeverity = (["observation", "minor_ncr", "major_ncr"] as const).map((severity) => ({
    severity,
    label: NCR_SEVERITY_LABEL[severity],
    total: ncrRows.filter((n) => n.severity === severity).length,
    closed: ncrRows.filter((n) => n.severity === severity && n.status === "closed").length,
  }));

  const punchRows = punchItems ?? [];
  const punchTotal = punchRows.length;
  const punchClosed = punchRows.filter((p) => p.status === "closed").length;
  const punchResolvedNotClosed = punchRows.filter((p) => p.status === "resolved").length;

  const Heading = embedded ? "h2" : "h1";
  return (
    <div className={embedded ? "" : "max-w-3xl"}>
      <RealtimeRefresh table="data_books" filter={`project_id=eq.${projectId}`} />
      {!embedded && (
        <Link href={`/inspect/projects/${projectId}`} className="text-sm text-burgundy hover:underline">
          ← Back to Project
        </Link>
      )}
      <div className="mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="doc-id text-2xl font-semibold text-ink">{embedded ? "Data book" : `${project.project_number} — Data Book`}</Heading>
          <PageGuide
            title="Data Book — how this works"
            points={[
              "Won't compile while any category is below 100% or any punch list item is open or resolved-but-not-yet-verified — every ITP must be approved, every NCR closed, and every punch item independently closed (not just marked resolved).",
              "A JAGS staff member can override that and compile anyway (a \"Conditional Handover\"), but only with a required, documented reason — the still-outstanding punch items (open or resolved-but-unverified) are snapshotted onto the record at that moment, reason and who approved it included.",
              "Only JAGS staff can create a Data Book, compile a draft one, or issue a handover once compiled — everyone else with project access can view readiness and download issued PDFs.",
              "\"Data-book readiness\" on the Client KPIs page is a proxy metric; this page computes it directly from the project's own ITPs, NCRs and punch list.",
            ]}
          />
        </div>
        <p className="mt-1 text-sm text-muted">
          {project.organizations?.name} · {project.name}
        </p>
      </div>

      <DataBookStructurePanel
        readiness={readiness}
        partyCount={(parties ?? []).length}
        ncrTotal={ncrTotal}
        ncrClosed={ncrClosed}
        punchTotal={punchTotal}
        punchClosed={punchClosed}
        latestStatus={((dataBooks ?? [])[0]?.status as "draft" | "compiled" | "issued" | undefined) ?? null}
        handoverIssued={dataBookCertificates.some(Boolean)}
      />

      {/* Project completion dossier summary — "what was done, who did it, how, when" per the client's
          own framing of what a Data Book is meant to be, not just a readiness meter. */}
      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-base font-medium text-ink">Project summary</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Project</dt>
            <dd className="mt-0.5 text-sm text-ink">
              {project.project_number} — {project.name}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Client organisation</dt>
            <dd className="mt-0.5 text-sm text-ink">{project.organizations?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Site / location</dt>
            <dd className="mt-0.5 text-sm text-ink">
              {[project.site_location, project.country].filter(Boolean).join(", ") || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Project period</dt>
            <dd className="mt-0.5 text-sm text-ink">
              {formatDate(project.start_date)} – {formatDate(project.end_date)}
            </dd>
          </div>
        </dl>

        <div className="mt-4 border-t border-border pt-3">
          <h3 className="text-xs uppercase tracking-wide text-muted">Project parties involved</h3>
          {(parties ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-muted">No active project parties recorded.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {(parties ?? []).map((party) => (
                <li key={party.id} className="rounded-md border border-border bg-off-white px-2.5 py-1 text-xs text-ink">
                  <span className="font-medium">{PARTY_TYPE_LABEL[party.party_type] ?? party.party_type}</span>
                  <span className="ml-1.5 text-muted">{party.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* What was done — real completed-work counts, same underlying tables as the compile PDF's own
          summary, surfaced here so the in-app page isn't thinner than the document it produces. */}
      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-base font-medium text-ink">What was done</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="ITPs on project"
            value={<span className="tabular-nums">{readiness.itps.total}</span>}
            caption={`${readiness.itps.ready} approved / client-accepted`}
          />
          <StatCard
            label="Inspection records"
            value={<span className="tabular-nums">{readiness.inspectionRecords.total}</span>}
            caption={`${readiness.inspectionRecords.ready} with issued IRN`}
          />
          <StatCard
            label="NCRs raised"
            value={<span className="tabular-nums">{ncrTotal}</span>}
            caption={ncrTotal === 0 ? undefined : `${ncrClosed}/${ncrTotal} closed`}
          />
          <StatCard
            label="Punch list items"
            value={<span className="tabular-nums">{punchTotal}</span>}
            caption={punchTotal === 0 ? undefined : `${punchClosed} closed, ${punchResolvedNotClosed} resolved (unverified)`}
          />
        </div>

        {ncrTotal > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <h3 className="text-xs uppercase tracking-wide text-muted">NCRs by severity</h3>
            <div className="mt-2 space-y-2">
              {ncrBySeverity
                .filter((row) => row.total > 0)
                .map((row) => (
                  <div key={row.severity} className="flex items-center justify-between text-sm">
                    <span className="text-ink">{row.label}</span>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted/15">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            row.severity === "major_ncr" ? "bg-danger" : row.severity === "minor_ncr" ? "bg-gold" : "bg-muted"
                          )}
                          style={{ width: `${row.total === 0 ? 0 : Math.round((row.closed / row.total) * 100)}%` }}
                        />
                      </div>
                      <Badge tone={row.closed === row.total ? "success" : "warning"}>
                        {row.closed}/{row.total} closed
                      </Badge>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Overall readiness"
          value={
            <span className="tabular-nums">
              {readiness.itps.total === 0 && readiness.ncrs.total === 0 ? "—" : `${readiness.overallPercentage}%`}
            </span>
          }
          caption={readiness.itps.total === 0 && readiness.ncrs.total === 0 ? "No data yet" : undefined}
        />
        <StatCard
          label="ITPs approved"
          value={
            <span className="tabular-nums">
              {readiness.itps.ready}/{readiness.itps.total}
            </span>
          }
        />
        <StatCard
          label="NCRs closed"
          value={
            <span className="tabular-nums">
              {readiness.ncrs.ready}/{readiness.ncrs.total}
            </span>
          }
        />
        <StatCard
          label="Open / unverified punch items"
          value={<span className="tabular-nums">{readiness.openPunchItems}</span>}
          caption={readiness.openPunchItems === 0 ? "Clear" : "Must be zero to compile"}
        />
      </div>

      <div className="mt-6">
        <ReadinessPanel readiness={readiness} />
      </div>

      <div className="mt-6">
        <DisciplineBreakdownPanel rows={disciplineBreakdown} />
      </div>

      {session.isJagsStaff && (
        <div className="mt-6">
          <CreateDataBookForm projectId={projectId} />
        </div>
      )}

      <div className="mt-6 space-y-4">
        {(dataBooks ?? []).map((book, index) => (
          <div key={book.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="doc-id text-sm font-medium text-ink">{book.book_number}</span>
                <span className="ml-2 text-sm text-ink">{book.title}</span>
                <p className="mt-0.5 text-xs text-muted">
                  Created {new Date(book.created_at).toLocaleDateString("en-GB")}
                  {book.compiled_at && ` · Compiled ${new Date(book.compiled_at).toLocaleDateString("en-GB")}`}
                </p>
              </div>
              <Badge tone={STATUS_TONE[book.status]}>{STATUS_LABEL[book.status]}</Badge>
            </div>

            {/* Chain-of-custody trail — the closing record for this data book: draft → compiled →
                issued → client acknowledged. Issued/acknowledged come from the handover_certificates
                row lib/handover/actions.ts writes; draft/compiled come from the data book itself. */}
            <ol className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
              {(["draft", "compiled", "issued", "acknowledged"] as const).map((step, stepIndex, arr) => {
                const cert = dataBookCertificates[index];
                const reached =
                  step === "draft"
                    ? true
                    : step === "compiled"
                      ? book.status === "compiled" || book.status === "issued"
                      : step === "issued"
                        ? book.status === "issued"
                        : Boolean(cert?.acknowledged_at);
                const label =
                  step === "draft"
                    ? "Draft"
                    : step === "compiled"
                      ? book.compiled_at
                        ? `Compiled ${formatDate(book.compiled_at)}`
                        : "Compiled"
                      : step === "issued"
                        ? cert
                          ? `Issued ${formatDate(cert.issued_date)}`
                          : "Issued"
                        : cert?.acknowledged_at
                          ? `Acknowledged ${formatDate(cert.acknowledged_at)}`
                          : "Acknowledged";
                return (
                  <li key={step} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5",
                        reached ? "border-success bg-success/10 text-success" : "border-border text-muted"
                      )}
                    >
                      {label}
                    </span>
                    {stepIndex < arr.length - 1 && <span className="text-muted">→</span>}
                  </li>
                );
              })}
            </ol>
            {dataBookCertificates[index]?.received_by_name && (
              <p className="mt-1 text-xs text-muted">
                Received by {dataBookCertificates[index]?.received_by_name}
                {dataBookCertificates[index]?.received_by_company ? ` (${dataBookCertificates[index]?.received_by_company})` : ""}
              </p>
            )}

            <div className="mt-3">
              <DataBookPdfButton dataBookId={book.id} projectId={projectId} latest={dataBookPdfStatuses[index]} />
            </div>

            {book.override_reason && (
              <div className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-ink">
                <p>
                  <span className="font-medium">Conditional — compiled with open items outstanding.</span>{" "}
                  {book.override_reason}
                </p>
                {book.override_items && book.override_items.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {book.override_items.map((item) => (
                      <li key={item.id}>
                        • {item.description}
                        {item.location ? ` (${item.location})` : ""} — {item.responsible_party_name ?? "unassigned"},
                        due {item.due_date ? new Date(item.due_date).toLocaleDateString("en-GB") : "no date set"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {session.isJagsStaff && book.status === "draft" && (
              <div className="mt-3">
                <CompileDataBookForm
                  projectId={projectId}
                  dataBookId={book.id}
                  isReady={readiness.isReady}
                  openPunchItems={openPunchItems}
                />
              </div>
            )}

            {session.isJagsStaff && book.status === "compiled" && (
              <div className="mt-3">
                <IssueHandoverForm projectId={projectId} dataBookId={book.id} />
              </div>
            )}

            {book.status === "issued" && (
              <p className="mt-2 text-xs text-muted">
                Issued {book.compiled_at ? new Date(book.compiled_at).toLocaleDateString("en-GB") : ""} — see the{" "}
                <a href="/inspect/handover" className="text-burgundy hover:underline">
                  Handover Portal
                </a>{" "}
                for the certificate and download.
              </p>
            )}
          </div>
        ))}

        {(dataBooks ?? []).length === 0 && (
          <p className="text-sm text-muted">No Data Book started for this project yet.</p>
        )}
      </div>
    </div>
  );
}
