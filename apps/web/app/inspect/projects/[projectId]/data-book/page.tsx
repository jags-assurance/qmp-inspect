import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { isModuleLicensed } from "@/lib/module-licensing/access";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { computeDataBookReadiness } from "@/lib/databook/readiness";
import { computeDataBookDisciplineBreakdown } from "@/lib/databook/discipline-breakdown";
import { DATA_BOOKS_TABLE, type DataBookRow, type DataBookStatus } from "@/lib/databook/types";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { getLatestDataBookPdf } from "@/lib/reports/actions";
import { ReadinessPanel } from "./readiness-panel";
import { DisciplineBreakdownPanel } from "./discipline-breakdown-panel";
import { CreateDataBookForm } from "./create-databook-form";
import { CompileDataBookForm, type OpenPunchItemPreview } from "./compile-databook-form";
import { IssueHandoverForm } from "./issue-handover-form";
import { DataBookPdfButton } from "./data-book-pdf-button";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";

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

export default async function DataBookPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, organization_id, organizations(name)")
    .eq("id", projectId)
    .maybeSingle<{ id: string; name: string; project_number: string; organization_id: string; organizations: { name: string } | null }>();

  if (!project) notFound();

  // R112 module licensing (page-level — see reports/page.tsx's doc comment for why: no single org
  // to gate at the shared /inspect layout). JAGS staff always bypass.
  if (!session.isJagsStaff && !(await isModuleLicensed(supabase, project.organization_id, "data_book"))) {
    redirect(`/inspect/projects/${projectId}`);
  }

  const [readiness, disciplineBreakdown, { data: dataBooks }, { data: openPunchItemRows }] = await Promise.all([
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
      .eq("status", "open")
      .returns<OpenPunchItemPreview[]>(),
  ]);

  const openPunchItems: OpenPunchItemPreview[] = openPunchItemRows ?? [];

  const dataBookPdfStatuses = await Promise.all(
    (dataBooks ?? []).map((book) => getLatestDataBookPdf(book.id))
  );

  return (
    <div className="max-w-3xl">
      <RealtimeRefresh table="data_books" filter={`project_id=eq.${projectId}`} />
      <div>
        <h1 className="doc-id text-2xl font-semibold text-ink">{project.project_number} — Data Book</h1>
        <p className="mt-1 text-sm text-muted">
          {project.organizations?.name} · {project.name}
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Overall readiness"
          value={
            <span className="tabular-nums">{readiness.overallPercentage}%</span>
          }
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
          label="Open punch items"
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
                  Created {new Date(book.created_at).toLocaleDateString()}
                  {book.compiled_at && ` · Compiled ${new Date(book.compiled_at).toLocaleDateString()}`}
                </p>
              </div>
              <Badge tone={STATUS_TONE[book.status]}>{STATUS_LABEL[book.status]}</Badge>
            </div>

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
                        due {item.due_date ? new Date(item.due_date).toLocaleDateString() : "no date set"}
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
                Issued {book.compiled_at ? new Date(book.compiled_at).toLocaleDateString() : ""} — see the{" "}
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
