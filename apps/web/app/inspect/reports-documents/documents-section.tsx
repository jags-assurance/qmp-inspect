import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { vaultDocKind } from "@/lib/vault/doc-kind";
import { getSignedPhotoUrls } from "@/lib/storage/signed-urls";
import { VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";
import { GENERATED_DOCUMENTS_BUCKET } from "@/lib/reports/types";
import { T } from "@/components/domain/t";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Section } from "@/components/ui/section";
import { FilterBar, FilterField } from "@/components/ui/toolbar";
import { FILTER_CONTROL_CLASS } from "@/components/ui/filter-styles";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/dates/format";

export const DOC_PAGE_SIZE = 50;
const GENERATED_PREFIX = "generated-documents:";

export interface DocSearchParams {
  project?: string;
  q?: string;
  type?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: string;
}

export interface GeneratedDocRow {
  id: string;
  title: string;
  revision: string;
  status: string;
  createdAt: string;
  projectId: string;
  projectLabel: string;
  typeKey: string;
  typeLabel: string;
  url: string | null;
}

export interface DocumentsResult {
  rows: GeneratedDocRow[];
  total: number;
  page: number;
}

const TYPE_OPTIONS: { key: string; label: string }[] = [
  { key: "itp", label: "ITP" },
  { key: "inspection_report", label: "Inspection report" },
  { key: "irn", label: "IRN" },
  { key: "ncr", label: "NCR" },
  { key: "ncr_closeout", label: "NCR close-out" },
  { key: "fat", label: "FAT report" },
  { key: "data_book", label: "Data Book / handover" },
  { key: "pack", label: "Weekly / monthly pack" },
  { key: "portfolio", label: "Portfolio summary" },
  { key: "generated", label: "Other generated" },
];

function classify(title: string, storagePath: string): { key: string; label: string } {
  if (/\b(IRN|inspection release note)\b/i.test(title)) return { key: "irn", label: "IRN" };
  if (/\bFAT\b|factory acceptance/i.test(title)) return { key: "fat", label: "FAT report" };
  if (/data ?book|handover/i.test(title)) return { key: "data_book", label: "Data Book / handover" };
  if (/\b(weekly|monthly)\b.*\b(pack|report)\b/i.test(title)) return { key: "pack", label: "Weekly / monthly pack" };
  if (/^portfolio summary/i.test(title)) return { key: "portfolio", label: "Portfolio summary" };
  const k = vaultDocKind({ storagePath, title });
  return { key: k.key, label: k.label };
}

/** Escapes characters that are special inside a PostgREST ilike filter value. */
function likeSafe(v: string): string {
  return v.replace(/[%,()*\\]/g, " ").trim();
}

export async function loadDocuments(
  supabase: SupabaseClient,
  sp: DocSearchParams,
  selectedProject: string | null
): Promise<DocumentsResult> {
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  // "project=all" shows every project the user can see; otherwise the picker's project.
  const projectFilter = sp.project === "all" ? null : selectedProject;

  let query = supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .select(
      "id, title, revision, status, created_at, storage_path, vault_folders!inner(project_id, projects(project_number, name))",
      { count: "exact" }
    )
    .like("storage_path", `${GENERATED_PREFIX}%`)
    .order("created_at", { ascending: false });

  if (projectFilter) query = query.eq("vault_folders.project_id", projectFilter);
  if (sp.status) query = query.eq("status", sp.status);
  if (sp.from) query = query.gte("created_at", `${sp.from}T00:00:00Z`);
  if (sp.to) query = query.lte("created_at", `${sp.to}T23:59:59Z`);
  const q = likeSafe(sp.q ?? "");
  if (q) query = query.ilike("title", `%${q}%`);

  // Type is derived from the title patterns, so it is filtered after the fetch of the current
  // window when set (page size is applied to the filtered set via a larger fetch window).
  const typeFilter = sp.type || "";
  const from = typeFilter ? 0 : (page - 1) * DOC_PAGE_SIZE;
  const to = typeFilter ? 999 : from + DOC_PAGE_SIZE - 1;
  const { data, count } = await query.range(from, to);

  type Raw = {
    id: string;
    title: string;
    revision: string;
    status: string;
    created_at: string;
    storage_path: string;
    vault_folders: { project_id: string; projects: { project_number: string; name: string } | null } | null;
  };
  let raw = (data ?? []) as Raw[];
  let total = count ?? raw.length;
  if (typeFilter) {
    raw = raw.filter((r) => classify(r.title, r.storage_path).key === typeFilter);
    total = raw.length;
    raw = raw.slice((page - 1) * DOC_PAGE_SIZE, page * DOC_PAGE_SIZE);
  }

  const paths = raw.map((r) => r.storage_path.slice(GENERATED_PREFIX.length));
  const urls = await getSignedPhotoUrls(supabase, GENERATED_DOCUMENTS_BUCKET, paths, 600);

  return {
    page,
    total,
    rows: raw.map((r) => {
      const c = classify(r.title, r.storage_path);
      const proj = r.vault_folders?.projects;
      return {
        id: r.id,
        title: r.title,
        revision: r.revision,
        status: r.status,
        createdAt: r.created_at,
        projectId: r.vault_folders?.project_id ?? "",
        projectLabel: proj ? `${proj.project_number} - ${proj.name}` : "Project",
        typeKey: c.key,
        typeLabel: c.label,
        url: urls.get(r.storage_path.slice(GENERATED_PREFIX.length)) ?? null,
      };
    }),
  };
}

function pageHref(sp: DocSearchParams, page: number): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, page: String(page) })) if (v) p.set(k, v);
  return `/inspect/reports-documents?${p.toString()}`;
}

const STATUS_TONE: Record<string, Tone> = {
  approved: "success",
  for_review: "warning",
  superseded: "neutral",
  rejected: "danger",
};

export function DocumentsSection({
  docs,
  sp,
  projects,
  selectedProject,
}: {
  docs: DocumentsResult;
  sp: DocSearchParams;
  projects: { id: string; project_number: string; name: string }[];
  selectedProject: string | null;
}) {
  const lastPage = Math.max(1, Math.ceil(docs.total / DOC_PAGE_SIZE));
  const activeFilterCount = [sp.q, sp.type, sp.status, sp.from, sp.to, sp.project === "all" ? "all" : ""].filter(Boolean).length;
  const pagerLink = "inline-flex min-h-11 items-center font-medium text-brand hover:underline";
  return (
    <Section
      title={<T>Generated documents</T>}
      description={<T>Newest first. Links expire; reload for a fresh one.</T>}
      className="scroll-mt-24"
    >
      {/* Keyed on the filters: Reset is a client-side navigation, so without a remount the uncontrolled
          selects kept showing the old Project/Type/Status values. */}
      <FilterBar
        className="mb-4 shadow-none"
        activeCount={activeFilterCount}
        clearHref="/inspect/reports-documents?project=all"
        filters={
          <form key={JSON.stringify(sp)} method="get" className="flex w-full flex-col gap-4 md:w-auto md:flex-row md:flex-wrap md:items-end md:gap-3">
            <FilterField label={<T>Search</T>}>
              <input aria-label="Search title" name="q" defaultValue={sp.q ?? ""} placeholder="Search title" className={FILTER_CONTROL_CLASS} />
            </FilterField>
            <FilterField label={<T>Project</T>}>
              <select name="project" defaultValue={sp.project === "all" ? "all" : (selectedProject ?? "")} className={FILTER_CONTROL_CLASS}>
                <option value="all"><T>All projects</T></option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_number} - {p.name}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label={<T>Type</T>}>
              <select name="type" defaultValue={sp.type ?? ""} className={FILTER_CONTROL_CLASS}>
                <option value=""><T>All types</T></option>
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label={<T>Status</T>}>
              <select name="status" defaultValue={sp.status ?? ""} className={FILTER_CONTROL_CLASS}>
                <option value=""><T>Any status</T></option>
                <option value="for_review"><T>For review</T></option>
                <option value="approved"><T>Approved</T></option>
                <option value="superseded"><T>Superseded</T></option>
                <option value="rejected"><T>Rejected</T></option>
              </select>
            </FilterField>
            <FilterField label={<T>From date</T>}>
              <input type="date" name="from" defaultValue={sp.from ?? ""} className={FILTER_CONTROL_CLASS} />
            </FilterField>
            <FilterField label={<T>To date</T>}>
              <input type="date" name="to" defaultValue={sp.to ?? ""} className={FILTER_CONTROL_CLASS} />
            </FilterField>
            <Button type="submit" variant="outline">
              <T>Apply filters</T>
            </Button>
          </form>
        }
      />

      {docs.rows.length === 0 ? (
        <EmptyState
          compact
          title={<T>No generated documents match.</T>}
          description={<T>Documents appear here automatically once a PDF is requested from an ITP, inspection, NCR, FAT or Data Book.</T>}
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {docs.rows.map((d) => (
            <li key={d.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="line-clamp-2 font-medium text-ink [overflow-wrap:anywhere]" title={d.title}>{d.title}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {d.projectLabel} - {formatDate(d.createdAt)}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral" showIcon={false}>{d.typeLabel}</Badge>
                  <Badge tone="neutral" showIcon={false}><T>Rev</T> {d.revision}</Badge>
                  <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{d.status.replace("_", " ")}</Badge>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {d.url ? (
                  <>
                    <a href={d.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                      <T>View</T>
                    </a>
                    {/* The download attribute is ignored on a cross-origin storage link; Supabase's own
                        download parameter makes the file save instead of opening. */}
                    <a href={`${d.url}${d.url.includes("?") ? "&" : "?"}download=`} download className={buttonVariants({ variant: "outline", size: "sm" })}>
                      <T>Download</T>
                    </a>
                  </>
                ) : (
                  <span className="inline-flex min-h-8 items-center text-xs text-muted"><T>File unavailable</T></span>
                )}
                {d.projectId && (
                  <Link href={`/inspect/vault/${d.projectId}/document/${d.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    <T>Open</T>
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          {docs.page > 1 ? (
            <Link href={pageHref(sp, docs.page - 1)} className={pagerLink}>
              <T>Previous</T>
            </Link>
          ) : (
            <span />
          )}
          <span className="text-center text-muted">
            <T>Page</T> {docs.page} <T>of</T> {lastPage} ({docs.total} <T>documents)</T>
          </span>
          {docs.page < lastPage ? (
            <Link href={pageHref(sp, docs.page + 1)} className={pagerLink}>
              <T>Next</T>
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </Section>
  );
}
