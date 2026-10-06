import { formatLocationForDisplay } from "@/lib/checklists/location";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { isModuleLicensed } from "@/lib/module-licensing/access";
import { Badge } from "@/components/ui/badge";
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
import { DataBookIndex, DataBookMiniNav, buildDataBookParts } from "./structure-panel";
import { DoneActivitiesPanel } from "./done-activities-panel";
import { DataBookUpdatesPanel } from "./updates-panel";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";

const STATUS_TONE: Record<DataBookStatus, "neutral" | "warning" | "success"> = {
  draft: "neutral",
  compiled: "warning",
  issued: "success",
};

// Book state wording used in the banner (draft → for review → final/issued).
const STATUS_LABEL: Record<DataBookStatus, string> = {
  draft: "Draft",
  compiled: "For review",
  issued: "Final — issued",
};

const PARTY_TYPE_LABEL: Record<string, string> = {
  client: "Client",
  main_contractor: "Main Contractor",
  subcontractor: "Subcontractor",
  tpi_lab: "TPI / Lab",
  vendor: "Vendor",
  jags: "JAGS Assurance",
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("en-GB") : "—";
}

function Card({ id, title, children, hint }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 rounded-lg border border-border bg-surface p-4">
      <h2 id={`${id}-h`} className="text-base font-medium text-ink">
        {title}
      </h2>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Tick({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
        ok ? "bg-success" : "bg-danger"
      )}
    >
      {ok ? "✓" : "✕"}
    </span>
  );
}

export async function DataBookView({ projectId, embedded = false, sp = {} }: { projectId: string; embedded?: boolean; sp?: Record<string, string | undefined> }) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, site_location, country, start_date, end_date, status, organization_id, organizations(name)")
    .eq("id", projectId)
    .maybeSingle<{
      id: string;
      name: string;
      project_number: string;
      site_location: string | null;
      country: string | null;
      start_date: string | null;
      end_date: string | null;
      status: string | null;
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
    supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id, description, location, due_date, project_parties(name)")
      .eq("project_id", projectId)
      .neq("status", "closed")
      .returns<OpenPunchItemPreview[]>(),
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

  const books = dataBooks ?? [];
  const openPunchItems: OpenPunchItemPreview[] = openPunchItemRows ?? [];

  const dataBookPdfStatuses = await Promise.all(books.map((book) => getLatestDataBookPdf(book.id)));

  const dataBookCertificates = await Promise.all(
    books.map((book) =>
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

  // Who compiled each book (display name) — best-effort, falls back to "—".
  const compilerIds = Array.from(new Set(books.map((b) => b.compiled_by).filter((v): v is string => Boolean(v))));
  const compilerNames = new Map<string, string>();
  if (compilerIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", compilerIds)
      .returns<{ id: string; full_name: string | null }[]>();
    for (const u of users ?? []) if (u.full_name) compilerNames.set(u.id, u.full_name);
  }

  const ncrRows = ncrs ?? [];
  const countedNcrs = ncrRows.filter((n) => n.severity !== "observation");
  const ncrTotal = countedNcrs.length;
  const ncrClosed = countedNcrs.filter((n) => n.status === "closed").length;

  const punchRows = punchItems ?? [];
  const punchTotal = punchRows.length;
  const punchClosed = punchRows.filter((p) => p.status === "closed").length;

  const base = `/inspect/projects/${projectId}`;
  const latest = books[0] ?? null;
  const latestPdf = dataBookPdfStatuses[0] ?? null;
  const latestCert = dataBookCertificates[0] ?? null;
  const handoverIssued = dataBookCertificates.some(Boolean);
  const hasData = [readiness.itps, readiness.inspectionRecords, readiness.checklists, readiness.ncrs].some((c) => c.total > 0);
  const readinessPct = hasData ? readiness.overallPercentage : 0;

  const projectCompleted = project.status === "completed";
  const statusText = (project.status ?? "unknown").replace(/_/g, " ");

  // Hard gates for a FINAL book. Each carries what is missing and where to fix it.
  const categoryGates = [
    { label: "ITPs approved or accepted", cat: readiness.itps, href: `${base}/workspace` },
    { label: "Inspection records with issued IRN", cat: readiness.inspectionRecords, href: "/inspect/inspections" },
    { label: "Checklists completed", cat: readiness.checklists, href: "/inspect/checklists" },
    { label: "Calibration certificates in date", cat: readiness.calibrationRegister, href: `${base}/registers` },
    { label: "Welder qualifications valid", cat: readiness.welderRegister, href: `${base}/registers` },
    { label: "Personnel certifications valid", cat: readiness.personnelRegister, href: `${base}/registers` },
    { label: "Materials approved and released", cat: readiness.materialRegister, href: `${base}/registers` },
    { label: "Standalone assignments cleared", cat: readiness.standaloneAssignments, href: "/inspect/standalone" },
    { label: "NCRs closed", cat: readiness.ncrs, href: "/inspect/ncrs" },
  ].map((g) => ({
    label: g.label,
    ok: g.cat.percentage === 100,
    detail: g.cat.total === 0 ? "No items yet" : `${g.cat.ready} of ${g.cat.total} (${g.cat.percentage}%)`,
    missing: g.cat.total - g.cat.ready,
    href: g.href,
  }));
  const gates = [
    ...categoryGates.map((g) => ({
      label: g.label,
      ok: g.ok,
      detail: g.detail,
      fix: g.ok ? null : `${g.missing} outstanding`,
      href: g.href,
    })),
    {
      label: "Punch list has zero open items",
      ok: readiness.openPunchItems === 0,
      detail: readiness.openPunchItems === 0 ? "Clear" : `${readiness.openPunchItems} open or unverified`,
      fix: readiness.openPunchItems === 0 ? null : "Close or verify each item",
      href: `${base}/punch-list`,
    },
    {
      label: "Project status is Completed",
      ok: projectCompleted,
      detail: `Currently ${statusText}`,
      fix: projectCompleted ? null : "Mark the project Completed, or compile with a documented override reason",
      href: base,
    },
  ];
  const allGatesPass = gates.every((g) => g.ok) && readiness.isReady;
  const failingGates = gates.filter((g) => !g.ok);

  const parts = buildDataBookParts({
    projectId,
    readiness,
    partyCount: (parties ?? []).length,
    ncrTotal,
    ncrClosed,
    punchTotal,
    punchClosed,
    latestStatus: latest?.status ?? null,
    handoverIssued,
  });

  const Heading = embedded ? "h2" : "h1";
  const bannerTone = latest ? STATUS_TONE[latest.status] : "neutral";

  return (
    <div className={embedded ? "" : "max-w-6xl"}>
      <RealtimeRefresh table="data_books" filter={`project_id=eq.${projectId}`} />
      {!embedded && (
        <Link href={base} className="text-sm text-burgundy hover:underline">
          ← Back to Project
        </Link>
      )}

      {/* Compact header */}
      <header className="mt-2">
        <Heading className="doc-id text-2xl font-semibold text-ink">{embedded ? "Data book" : `${project.project_number} — Data Book`}</Heading>
        <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          <div className="flex gap-1">
            <dt className="sr-only">Project</dt>
            <dd className="text-ink">{project.name}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Client:</dt>
            <dd className="text-ink">{project.organizations?.name ?? "—"}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Site:</dt>
            <dd className="text-ink">{[project.site_location, project.country].filter(Boolean).join(", ") || "—"}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Period:</dt>
            <dd className="text-ink">
              {formatDate(project.start_date)} – {formatDate(project.end_date)}
            </dd>
          </div>
        </dl>
      </header>

      {/* Status banner */}
      <section id="status" aria-label="Data Book status" className="mt-4 scroll-mt-24 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[14rem] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">Book state</span>
              <Badge tone={bannerTone}>{latest ? STATUS_LABEL[latest.status] : "No book"}</Badge>
              {latest && (
                <span className="text-xs text-muted">
                  {latest.book_number} · revision {books.length}
                </span>
              )}
            </div>
            <div className="mt-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-ink">Readiness</span>
                <span className="tabular-nums font-medium text-ink">{hasData ? `${readinessPct}%` : "No data yet"}</span>
              </div>
              <div
                className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-muted/15"
                role="progressbar"
                aria-valuenow={readinessPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Data Book readiness"
              >
                <div className={cn("h-full rounded-full transition-all", allGatesPass ? "bg-success" : "bg-gold")} style={{ width: `${readinessPct}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {allGatesPass ? "All gates pass — ready for a final book." : `${failingGates.length} gate${failingGates.length === 1 ? "" : "s"} still open — see Ready to generate.`}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-start gap-2">
            {latest ? (
              <DataBookPdfButton
                key={latest.id}
                dataBookId={latest.id}
                projectId={projectId}
                latest={latestPdf}
                generateLabel={latest.status === "issued" ? "Generate PDF" : "Generate draft PDF"}
                isDraftBook={latest.status !== "issued"}
              />
            ) : (
              <a href="#generate" className="rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark">
                Generate Data Book
              </a>
            )}
            {latestCert && (
              <Link href="/inspect/handover" className="text-sm text-burgundy hover:underline">
                Handover certificate {latestCert.certificate_number} →
              </Link>
            )}
          </div>
        </div>
      </section>

      <details className="mt-3 rounded-lg border border-border bg-surface px-4 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-ink focus:outline-none focus:ring-2 focus:ring-burgundy">How this works</summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
          <li>A final book needs every category at 100%, zero open or unverified punch items, and a Completed project. Draft books can be generated at any time and are marked DRAFT.</li>
          <li>JAGS staff can compile anyway (a &quot;Conditional Handover&quot;) with a required documented reason; still-open punch items are snapshotted on the record with the reason and approver.</li>
          <li>Only JAGS staff can create a book, compile a draft, or issue a handover. Everyone with project access can view readiness and download PDFs.</li>
          <li>&quot;Data-book readiness&quot; on the Client KPIs page is a proxy metric; this page computes it directly from the project&apos;s own records.</li>
        </ul>
      </details>

      <div className="mt-4 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-6">
        <DataBookMiniNav />

        <div className="space-y-6">
          <DataBookIndex parts={parts} />

          {/* Ready to generate? */}
          <Card id="gates" title="Ready to generate?" hint="Hard gates for a final book. Fix each red item at its source page.">
            <ul className="divide-y divide-border rounded-md border border-border">
              {gates.map((g) => (
                <li key={g.label} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <Tick ok={g.ok} />
                  <span className="sr-only">{g.ok ? "Passed:" : "Not met:"}</span>
                  <span className="min-w-0 flex-1 text-ink">{g.label}</span>
                  <span className={cn("text-xs", g.ok ? "text-success" : "text-danger")}>{g.detail}</span>
                  {!g.ok && (
                    <Link href={g.href} className="text-xs font-medium text-burgundy hover:underline">
                      Fix →
                    </Link>
                  )}
                  {!g.ok && g.fix && <span className="w-full pl-8 text-xs text-muted">{g.fix}</span>}
                </li>
              ))}
            </ul>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-burgundy focus:outline-none focus:ring-2 focus:ring-burgundy">Category detail</summary>
              <div className="mt-2">
                <ReadinessPanel readiness={readiness} />
              </div>
            </details>
          </Card>

          {/* Generate */}
          <Card id="generate" title="Generate">
            {!session.isJagsStaff && (
              <p className="text-sm text-muted">Only JAGS staff can generate or compile a Data Book. You can view and download generated books below.</p>
            )}
            {session.isJagsStaff && books.length === 0 && (
              <div>
                <p className="mb-3 text-sm text-muted">No Data Book exists for this project yet. Create one to start generating draft PDFs and, once every gate passes, a final book.</p>
                <CreateDataBookForm projectId={projectId} />
              </div>
            )}
            {session.isJagsStaff && latest?.status === "draft" && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border border-border p-3">
                  <h3 className="text-sm font-semibold text-ink">Generate draft book now</h3>
                  <p className="mt-1 text-xs text-muted">
                    Produces a PDF stamped DRAFT — <strong>not issued</strong>. Safe to share for review; incomplete sections are shown as such.
                  </p>
                  <div className="mt-3">
                    <DataBookPdfButton
                      key={`gen-${latest.id}`}
                      dataBookId={latest.id}
                      projectId={projectId}
                      latest={latestPdf}
                      generateLabel="Generate draft book now"
                      isDraftBook
                    />
                  </div>
                </div>
                <div className="rounded-md border border-border p-3">
                  <h3 className="text-sm font-semibold text-ink">Generate final book</h3>
                  <p className="mt-1 text-xs text-muted">
                    {allGatesPass
                      ? "All gates pass. Compiling locks this book for review and issue."
                      : "Gates are not all met. Staff may compile anyway with a documented override reason."}
                  </p>
                  <div className="mt-3">
                    <CompileDataBookForm projectId={projectId} dataBookId={latest.id} isReady={allGatesPass} openPunchItems={openPunchItems} />
                  </div>
                </div>
              </div>
            )}
            {session.isJagsStaff && latest?.status === "compiled" && (
              <div>
                <p className="mb-2 text-sm text-muted">Book {latest.book_number} is compiled and awaiting review. Issue the handover to finalise it.</p>
                <IssueHandoverForm projectId={projectId} dataBookId={latest.id} />
              </div>
            )}
            {session.isJagsStaff && latest?.status === "issued" && (
              <div>
                <p className="mb-3 text-sm text-muted">The latest book is issued. Start a new book to produce a further revision.</p>
                <CreateDataBookForm projectId={projectId} />
              </div>
            )}
            {latest && (
              <p className="mt-3 text-xs text-muted">
                Latest: {latest.book_number}
                {latest.compiled_at
                  ? ` · generated ${new Date(latest.compiled_at).toLocaleString("en-GB")} by ${(latest.compiled_by && compilerNames.get(latest.compiled_by)) || "—"}`
                  : ` · created ${new Date(latest.created_at).toLocaleString("en-GB")} (not yet compiled)`}
                {" · "}revision {books.length}
              </p>
            )}
          </Card>

          {/* Books and revisions */}
          <Card id="books" title="Books and revisions">
            {books.length === 0 ? (
              <p className="text-sm text-muted">
                No Data Book started for this project yet.{" "}
                {session.isJagsStaff ? (
                  <a href="#generate" className="text-burgundy hover:underline">Create one →</a>
                ) : (
                  "Ask JAGS staff to start one."
                )}
              </p>
            ) : (
              <div className="space-y-3">
                {books.map((book, index) => {
                  const cert = dataBookCertificates[index];
                  const pdf = dataBookPdfStatuses[index];
                  const revision = books.length - index;
                  return (
                    <article key={book.id} aria-label={book.book_number} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="doc-id text-sm font-medium text-ink">{book.book_number}</span>
                          <span className="ml-2 text-sm text-ink">{book.title}</span>
                          <p className="mt-0.5 text-xs text-muted">
                            Revision {revision} · created {formatDate(book.created_at)}
                            {book.compiled_at && ` · compiled ${formatDate(book.compiled_at)}`}
                            {book.compiled_by && compilerNames.get(book.compiled_by) ? ` by ${compilerNames.get(book.compiled_by)}` : ""}
                          </p>
                        </div>
                        <Badge showIcon tone={STATUS_TONE[book.status]}>{STATUS_LABEL[book.status]}</Badge>
                      </div>

                      <ol className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                        {(["draft", "compiled", "issued", "acknowledged"] as const).map((step, stepIndex, arr) => {
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
                                ? book.compiled_at ? `For review ${formatDate(book.compiled_at)}` : "For review"
                                : step === "issued"
                                  ? cert ? `Issued ${formatDate(cert.issued_date)}` : "Issued"
                                  : cert?.acknowledged_at ? `Acknowledged ${formatDate(cert.acknowledged_at)}` : "Acknowledged";
                          return (
                            <li key={step} className="flex items-center gap-1.5">
                              <span className={cn("rounded-full border px-2 py-0.5", reached ? "border-success bg-success/10 text-success" : "border-border text-muted")}>
                                {label}
                              </span>
                              {stepIndex < arr.length - 1 && <span aria-hidden="true" className="text-muted">→</span>}
                            </li>
                          );
                        })}
                      </ol>
                      {cert?.received_by_name && (
                        <p className="mt-1 text-xs text-muted">
                          Received by {cert.received_by_name}
                          {cert.received_by_company ? ` (${cert.received_by_company})` : ""}
                        </p>
                      )}

                      {index > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                          {pdf?.status === "completed" && pdf.downloadUrl ? (
                            <>
                              <span className="text-xs text-muted">PDF {new Date(pdf.createdAt).toLocaleDateString("en-GB")}</span>
                              {pdf.pdfUrl && (
                                <a href={pdf.pdfUrl} target="_blank" rel="noreferrer" className="text-burgundy hover:underline">View ↗</a>
                              )}
                              <a href={pdf.downloadUrl} className="text-burgundy hover:underline">Download ↓</a>
                            </>
                          ) : (
                            <span className="text-xs text-muted">{pdf ? `PDF ${pdf.status}` : "No PDF generated for this revision."}</span>
                          )}
                        </div>
                      )}

                      {book.override_reason && (
                        <div className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-ink">
                          <p>
                            <span className="font-medium">Conditional — compiled with open items outstanding.</span> {book.override_reason}
                          </p>
                          {book.override_items && book.override_items.length > 0 && (
                            <ul className="mt-1.5 space-y-0.5">
                              {book.override_items.map((item) => (
                                <li key={item.id}>
                                  • {item.description}
                                  {item.location ? ` (${formatLocationForDisplay(item.location)})` : ""} — {item.responsible_party_name ?? "unassigned"}, due {item.due_date ? formatDate(item.due_date) : "no date set"}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Project summary */}
          <Card id="project-summary" title="Project summary">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {[
                ["Project", `${project.project_number} — ${project.name}`],
                ["Client organisation", project.organizations?.name ?? "—"],
                ["Site / location", [project.site_location, project.country].filter(Boolean).join(", ") || "—"],
                ["Project period", `${formatDate(project.start_date)} – ${formatDate(project.end_date)}`],
                ["Project status", statusText],
                ["Open NCRs / punch items", `${ncrTotal - ncrClosed} / ${punchTotal - punchClosed}`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
                  <dd className="mt-0.5 text-sm text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 border-t border-border pt-3">
              <h3 className="text-xs uppercase tracking-wide text-muted">Project parties involved</h3>
              {(parties ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  No active project parties recorded.{" "}
                  <Link href={base} className="text-burgundy hover:underline">Add parties →</Link>
                </p>
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
          </Card>

          {/* What was done */}
          <Card id="done" title="What was done">
            <DoneActivitiesPanel projectId={projectId} done={sp.done} itp={sp.itp} disc={sp.disc} status={sp.status} />
          </Card>

          <section id="disciplines" className="scroll-mt-24" aria-label="Breakdown by discipline">
            <DisciplineBreakdownPanel rows={disciplineBreakdown} />
          </section>

          <Card id="updates" title="Updates">
            {!session.isJagsStaff && (
              <p className="mb-2 text-xs text-muted">Note: the full audit trail is visible to JAGS staff only; you may see Data Book entries only.</p>
            )}
            <DataBookUpdatesPanel projectId={projectId} upd={sp.upd} updn={sp.updn} />
          </Card>
        </div>
      </div>
    </div>
  );
}
