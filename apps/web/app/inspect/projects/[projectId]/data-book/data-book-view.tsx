import { formatLocationForDisplay } from "@/lib/checklists/location";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { isModuleLicensed } from "@/lib/module-licensing/access";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { getDataBookReadiness } from "@/lib/databook/readiness-cached";
import { computeDataBookDisciplineBreakdown } from "@/lib/databook/discipline-breakdown";
import { DATA_BOOKS_TABLE, HANDOVER_CERTIFICATES_TABLE, type DataBookRow, type DataBookStatus } from "@/lib/databook/types";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { BACKGROUND_JOBS_TABLE } from "@/lib/reports/types";
import { isPdfOutOfDate } from "@/lib/databook/helpers";
import { isAdminStaff } from "@/lib/auth/session";
import { getLatestDataBookPdf } from "@/lib/reports/actions";
import { ReadinessPanel } from "./readiness-panel";
import { DisciplineBreakdownPanel } from "./discipline-breakdown-panel";
import { CreateDataBookForm } from "./create-databook-form";
import { CompileDataBookForm, type OpenPunchItemPreview } from "./compile-databook-form";
import { IssueHandoverForm } from "./issue-handover-form";
import { WithdrawDataBookForm } from "./withdraw-databook-form";
import { formatUtcDate, formatUtcDateTime } from "@/lib/databook/db-errors";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { DataBookPdfButton } from "./data-book-pdf-button";
import { DataBookIndex, DataBookMiniNav, buildDataBookParts } from "./structure-panel";
import { DoneActivitiesPanel } from "./done-activities-panel";
import { DataBookUpdatesPanel } from "./updates-panel";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { TransmittalSection } from "@/components/domain/transmittal-section";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

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

// Dates are shown in UTC with an explicit label where a time is shown (the server zone differs from the viewer's).
function formatDate(value: string | null): string {
  return value ? formatUtcDate(value) : "—";
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
  const tl = await getTranslator();
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
    { count: ncrAllCount },
    { count: ncrClosedCount },
    { count: punchAllCount },
    { count: punchClosedCount },
  ] = await Promise.all([
    getDataBookReadiness(session.userId, projectId).catch((err: unknown) => {
      // Fail closed: show the problem instead of a fabricated "100% ready".
      console.error("[data-book] readiness failed", err);
      return null;
    }),
    computeDataBookDisciplineBreakdown(projectId),
    supabase
      .from(DATA_BOOKS_TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .returns<DataBookRow[]>(),
    // Paged: PostgREST caps one response at 1000 rows, which silently truncated this list.
    fetchAll<OpenPunchItemPreview>((from, to) =>
      supabase
        .from(PUNCH_LIST_ITEMS_TABLE)
        .select("id, description, location, due_date, project_parties(name)")
        .eq("project_id", projectId)
        .neq("status", "closed")
        .order("id")
        .range(from, to)
        .returns<OpenPunchItemPreview[]>()
    ).then(
      (rows) => ({ data: rows as OpenPunchItemPreview[] | null }),
      () => ({ data: null as OpenPunchItemPreview[] | null })
    ),
    supabase
      .from("project_parties")
      .select("id, name, party_type, is_active")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .order("party_type")
      .returns<{ id: string; name: string; party_type: string; is_active: boolean }[]>(),
    // Counts only (head requests) - the full ncr / punch lists are never loaded into this page.
    supabase
      .from(NCRS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .or("severity.is.null,severity.neq.observation"),
    supabase
      .from(NCRS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .or("severity.is.null,severity.neq.observation")
      .eq("status", "closed"),
    supabase.from(PUNCH_LIST_ITEMS_TABLE).select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supabase.from(PUNCH_LIST_ITEMS_TABLE).select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "closed"),
  ]);

  if (!readiness) {
    return (
      <div className={embedded ? "" : "max-w-6xl"}>
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm text-ink" role="alert">
          <p className="font-medium"><T>The Data Book readiness could not be calculated right now.</T></p>
          <p className="mt-1 text-muted"><T>A data query failed, so no readiness figures are shown rather than showing figures that might be wrong. Reload the page to try again.</T></p>
        </div>
      </div>
    );
  }
  const books = dataBooks ?? [];
  const openPunchItems: OpenPunchItemPreview[] = openPunchItemRows ?? [];

  // Signed URLs only for the latest book; an older revision is signed lazily when its row is
  // expanded via ?pdfbook=<id> (each signing is a Storage round trip).
  const dataBookPdfStatuses = await Promise.all(
    books.map((book, i) => (i === 0 || sp.pdfbook === book.id ? getLatestDataBookPdf(book.id) : Promise.resolve(null)))
  );

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

  const ncrTotal = ncrAllCount ?? 0;
  const ncrClosed = ncrClosedCount ?? 0;
  const punchTotal = punchAllCount ?? 0;
  const punchClosed = punchClosedCount ?? 0;

  // "PDF out of date": data changed after the latest completed PDF job finished. Cheap version: the
  // newest ncrs.updated_at and punch created_at / closed_at. IRNs have no updated_at/project_id column,
  // so IRN issuance is not compared here (readiness gates still reflect it live).
  let pdfOutOfDate = false;
  if (books[0]) {
    const { data: lastJob } = await supabase
      .from(BACKGROUND_JOBS_TABLE)
      .select("completed_at")
      .eq("job_type", "render_data_book_pdf")
      .eq("payload->>data_book_id", books[0].id)
      .is("payload->>variant", null)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ completed_at: string | null }>();
    if (lastJob?.completed_at) {
      const [{ data: n }, { data: pc }, { data: pz }] = await Promise.all([
        supabase.from(NCRS_TABLE).select("updated_at").eq("project_id", projectId).order("updated_at", { ascending: false }).limit(1).returns<{ updated_at: string }[]>(),
        supabase.from(PUNCH_LIST_ITEMS_TABLE).select("created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).returns<{ created_at: string }[]>(),
        supabase.from(PUNCH_LIST_ITEMS_TABLE).select("closed_at").eq("project_id", projectId).not("closed_at", "is", null).order("closed_at", { ascending: false }).limit(1).returns<{ closed_at: string | null }[]>(),
      ]);
      pdfOutOfDate = isPdfOutOfDate(lastJob.completed_at, [n?.[0]?.updated_at, pc?.[0]?.created_at, pz?.[0]?.closed_at]);
    }
  }
  const isAdmin = isAdminStaff(session);

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
  const CORE_GATE_LABELS = new Set([
    "ITPs approved or accepted",
    "Inspection records with issued IRN",
    "Checklists completed",
    "ITP activities inspected and passed",
    "Hold and witness points signed off",
  ]);
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
    { label: "ITP activities inspected and passed", cat: readiness.activitiesExecuted, href: "/inspect/inspections" },
    { label: "Hold and witness points signed off", cat: readiness.holdPoints, href: `${base}/workspace` },
  ].map((g) => ({
    label: g.label,
    // A core category with nothing in it is "not started", not "complete".
    ok: g.cat.percentage === 100 && !(CORE_GATE_LABELS.has(g.label) && g.cat.total === 0),
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
          <T>← Back to Project</T>
        </Link>
      )}

      {/* Compact header */}
      <header className="mt-2">
        <Heading className="doc-id text-2xl font-semibold text-ink">{embedded ? "Data book" : `${project.project_number} — Data Book`}</Heading>
        <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          <div className="flex gap-1">
            <dt className="sr-only"><T>Project</T></dt>
            <dd className="text-ink">{project.name}</dd>
          </div>
          <div className="flex gap-1">
            <dt><T>Client:</T></dt>
            <dd className="text-ink">{project.organizations?.name ?? "—"}</dd>
          </div>
          <div className="flex gap-1">
            <dt><T>Site:</T></dt>
            <dd className="text-ink">{[project.site_location, project.country].filter(Boolean).join(", ") || "—"}</dd>
          </div>
          <div className="flex gap-1">
            <dt><T>Period:</T></dt>
            <dd className="text-ink">
              {formatDate(project.start_date)} – {formatDate(project.end_date)}
            </dd>
          </div>
        </dl>
      </header>

      {latest?.status === "issued" && !projectCompleted && (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-ink" role="status">
          <T>This project was re-opened after Data Book</T> {latest.book_number} <T>was issued (</T>{statusText}<T>). The issued handover still stands as it was certified; start a new revision when the re-opened work is finished.</T>
        </div>
      )}

      {/* Status banner */}
      <section id="status" aria-label={tl("Data Book status")} className="mt-4 scroll-mt-24 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="w-full sm:min-w-[14rem] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted"><T>Book state</T></span>
              <Badge tone={bannerTone}>{latest ? STATUS_LABEL[latest.status] : "No book"}</Badge>
              {latest && (
                <span className="text-xs text-muted">
                  {latest.book_number} <T>· Rev</T> {latest.revision ?? 0}
                </span>
              )}
            </div>
            <div className="mt-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-ink"><T>Readiness</T></span>
                <span className="tabular-nums font-medium text-ink">{hasData ? `${readinessPct}%` : "No data yet"}</span>
              </div>
              <div
                className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-muted/15"
                role="progressbar"
                aria-valuenow={readinessPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={tl("Data Book readiness")}
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
                canGenerate={session.isJagsStaff}
                isAdmin={isAdmin}
                pdfOutOfDate={pdfOutOfDate}
              />
            ) : (
              <a href="#generate" className="rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark">
                <T>Generate Data Book</T>
              </a>
            )}
            {latestCert && (
              <Link href="/inspect/handover" className="text-sm text-burgundy hover:underline">
                <T>Handover certificate</T> {latestCert.certificate_number} →
              </Link>
            )}
          </div>
        </div>
      </section>

      <details className="mt-3 rounded-lg border border-border bg-surface px-4 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-ink focus:outline-none focus:ring-2 focus:ring-burgundy"><T>How this works</T></summary>
        <ul className="mt-2 list-disc space-y-1.5 ps-5 text-muted">
          <li><T>A final book needs every category at 100%, zero open or unverified punch items, and a Completed project. Draft books can be generated at any time and are marked DRAFT.</T></li>
          <li><T>JAGS staff can compile anyway (a &quot;Conditional Handover&quot;) with a required documented reason; still-open punch items are snapshotted on the record with the reason and approver.</T></li>
          <li><T>Only JAGS staff can create a book, compile a draft, or issue a handover (a JAGS Admin for anything with an override). Books, certificates and packages are visible to JAGS staff and the client only.</T></li>
          <li><T>&quot;Data-book readiness&quot; on the Client KPIs page is a proxy metric; this page computes it directly from the project&apos;s own records.</T></li>
        </ul>
      </details>

      <div className="mt-4 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-6">
        <DataBookMiniNav />

        <div className="space-y-6">
          <DataBookIndex parts={parts} />

          {/* Ready to generate? */}
          <Card id="gates" title={tl("Ready to generate?")} hint="Hard gates for a final book. Fix each red item at its source page.">
            <ul className="divide-y divide-border rounded-md border border-border">
              {gates.map((g) => (
                <li key={g.label} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <Tick ok={g.ok} />
                  <span className="sr-only">{g.ok ? "Passed:" : "Not met:"}</span>
                  <span className="min-w-0 flex-1 text-ink">{g.label}</span>
                  <span className={cn("text-xs", g.ok ? "text-success" : "text-danger")}>{g.detail}</span>
                  {!g.ok && (
                    <Link href={g.href} className="text-xs font-medium text-burgundy hover:underline">
                      <T>Fix →</T>
                    </Link>
                  )}
                  {!g.ok && g.fix && <span className="w-full ps-8 text-xs text-muted">{g.fix}</span>}
                </li>
              ))}
            </ul>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-burgundy focus:outline-none focus:ring-2 focus:ring-burgundy"><T>Category detail</T></summary>
              <div className="mt-2">
                <ReadinessPanel readiness={readiness} />
              </div>
            </details>
          </Card>

          {/* Generate */}
          <Card id="generate" title={tl("Generate")}>
            {!session.isJagsStaff && (
              <p className="text-sm text-muted"><T>Only JAGS staff can generate or compile a Data Book. You can view and download generated books below.</T></p>
            )}
            {session.isJagsStaff && books.length === 0 && (
              <div>
                <p className="mb-3 text-sm text-muted"><T>No Data Book exists for this project yet. Create one to start generating draft PDFs and, once every gate passes, a final book.</T></p>
                <CreateDataBookForm projectId={projectId} />
              </div>
            )}
            {session.isJagsStaff && latest?.status === "draft" && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border border-border p-3">
                  <h3 className="text-sm font-semibold text-ink"><T>Generate draft book now</T></h3>
                  <p className="mt-1 text-xs text-muted">
                    <T>Produces a PDF stamped DRAFT —</T> <strong><T>not issued</T></strong><T>. Safe to share for review; incomplete sections are shown as such.</T>
                  </p>
                  <div className="mt-3">
                    <DataBookPdfButton
                      key={`gen-${latest.id}`}
                      dataBookId={latest.id}
                      projectId={projectId}
                      latest={latestPdf}
                      generateLabel="Generate draft book now"
                      isDraftBook
                      canGenerate={session.isJagsStaff}
                      isAdmin={isAdmin}
                      pdfOutOfDate={pdfOutOfDate}
                    />
                  </div>
                </div>
                <div className="rounded-md border border-border p-3">
                  <h3 className="text-sm font-semibold text-ink"><T>Generate final book</T></h3>
                  <p className="mt-1 text-xs text-muted">
                    {allGatesPass
                      ? "All gates pass. Compiling locks this book for review and issue."
                      : "Gates are not all met. A JAGS Admin may compile anyway with a documented override reason."}
                  </p>
                  <div className="mt-3">
                    <CompileDataBookForm
                      projectId={projectId}
                      dataBookId={latest.id}
                      bookNumber={latest.book_number}
                      isReady={allGatesPass}
                      isAdmin={isAdmin}
                      outstanding={failingGates.map((g) => `${g.label}: ${g.fix ?? g.detail}`)}
                      openPunchItems={openPunchItems}
                    />
                  </div>
                </div>
              </div>
            )}
            {session.isJagsStaff && latest?.status === "compiled" && (
              <div>
                <p className="mb-2 text-sm text-muted"><T>Book</T> {latest.book_number} <T>is compiled and awaiting review. Issue the handover to finalise it.</T></p>
                <IssueHandoverForm projectId={projectId} dataBookId={latest.id} bookNumber={latest.book_number} isConditional={latest.override_open_punch_items} />
                {isAdmin && <WithdrawDataBookForm projectId={projectId} dataBookId={latest.id} />}
              </div>
            )}
            {session.isJagsStaff && latest?.status === "issued" && (
              <div>
                <p className="mb-3 text-sm text-muted"><T>The latest book is issued. Start a new book to produce a further revision.</T></p>
                <CreateDataBookForm projectId={projectId} revisionOf={latest.book_number} />
                <TransmittalSection entityType="data_book" entityId={latest.id} projectId={projectId} status={latest.status} />
              </div>
            )}
            {latest && (
              <p className="mt-3 text-xs text-muted">
                <T>Latest:</T> {latest.book_number}
                {latest.compiled_at
                  ? ` · generated ${formatUtcDateTime(latest.compiled_at)} by ${(latest.compiled_by && compilerNames.get(latest.compiled_by)) || "—"}`
                  : ` · created ${formatUtcDateTime(latest.created_at)} (not yet compiled)`}
                {" · "}<T>Rev</T> {latest.revision ?? 0}
              </p>
            )}
          </Card>

          {/* Books and revisions */}
          <Card id="books" title={tl("Books and revisions")}>
            {books.length === 0 ? (
              <p className="text-sm text-muted">
                <T>No Data Book started for this project yet.</T>{" "}
                {session.isJagsStaff ? (
                  <a href="#generate" className="text-burgundy hover:underline"><T>Create one →</T></a>
                ) : (
                  "Ask JAGS staff to start one."
                )}
              </p>
            ) : (
              <div className="space-y-3">
                {books.map((book, index) => {
                  const cert = dataBookCertificates[index];
                  const pdf = dataBookPdfStatuses[index];
                  const revision = book.revision ?? 0;
                  return (
                    <article key={book.id} aria-label={book.book_number} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="doc-id text-sm font-medium text-ink">{book.book_number}</span>
                          <span className="ms-2 text-sm text-ink">{book.title}</span>
                          <p className="mt-0.5 text-xs text-muted">
                            <T>Rev</T> {revision} <T>· created</T> {formatDate(book.created_at)}
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
                          <T>Received by</T> {cert.received_by_name}
                          {cert.received_by_company ? ` (${cert.received_by_company})` : ""}
                        </p>
                      )}

                      {index > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                          {pdf?.status === "completed" && pdf.downloadUrl ? (
                            <>
                              <span className="text-xs text-muted"><T>PDF</T> {formatUtcDate(pdf.createdAt)}</span>
                              {pdf.pdfUrl && (
                                <a href={pdf.pdfUrl} target="_blank" rel="noreferrer" className="text-burgundy hover:underline"><T>View ↗</T></a>
                              )}
                              <a href={pdf.downloadUrl} className="text-burgundy hover:underline"><T>Download ↓</T></a>
                            </>
                          ) : (
                            <>
                              <span className="text-xs text-muted">{pdf ? `PDF ${pdf.status}` : "PDF links load on demand."}</span>
                              {!pdf && (
                                <Link href={`?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(sp).filter(([, v]) => v !== undefined)) as Record<string, string>), pdfbook: book.id }).toString()}#books`} scroll={false} className="text-burgundy hover:underline">
                                  <T>Load PDF links</T>
                                </Link>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {book.override_reason && (
                        <div className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-ink">
                          <p>
                            <span className="font-medium"><T>Conditional — compiled with open items outstanding.</T></span> {book.override_reason}
                          </p>
                          {book.override_items && book.override_items.length > 0 && (
                            <ul className="mt-1.5 space-y-0.5">
                              {book.override_items.map((item) => (
                                <li key={item.id}>
                                  • {item.description}
                                  {item.location ? ` (${formatLocationForDisplay(item.location)})` : ""} — {item.responsible_party_name ?? "unassigned"}<T>, due</T> {item.due_date ? formatDate(item.due_date) : "no date set"}
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
          <Card id="project-summary" title={tl("Project summary")}>
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
              <h3 className="text-xs uppercase tracking-wide text-muted"><T>Project parties involved</T></h3>
              {(parties ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  <T>No active project parties recorded.</T>{" "}
                  <Link href={base} className="text-burgundy hover:underline"><T>Add parties →</T></Link>
                </p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {(parties ?? []).map((party) => (
                    <li key={party.id} className="rounded-md border border-border bg-off-white px-2.5 py-1 text-xs text-ink">
                      <span className="font-medium">{PARTY_TYPE_LABEL[party.party_type] ?? party.party_type}</span>
                      <span className="ms-1.5 text-muted">{party.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* What was done */}
          <Card id="done" title={tl("What was done")}>
            <DoneActivitiesPanel projectId={projectId} done={sp.done} itp={sp.itp} disc={sp.disc} status={sp.status} />
          </Card>

          <section id="disciplines" className="scroll-mt-24" aria-label={tl("Breakdown by discipline")}>
            <DisciplineBreakdownPanel rows={disciplineBreakdown} />
          </section>

          <Card id="updates" title={tl("Updates")}>
            {!session.isJagsStaff && (
              <p className="mb-2 text-xs text-muted"><T>Note: the full audit trail is visible to JAGS staff only; you may see Data Book entries only.</T></p>
            )}
            <DataBookUpdatesPanel projectId={projectId} upd={sp.upd} updn={sp.updn} />
          </Card>
        </div>
      </div>
    </div>
  );
}
