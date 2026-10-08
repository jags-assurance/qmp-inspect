import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { vaultDocKind } from "@/lib/vault/doc-kind";
import { getSignedPhotoUrls } from "@/lib/storage/signed-urls";
import { VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";
import { GENERATED_DOCUMENTS_BUCKET } from "@/lib/reports/types";
import { T } from "@/components/domain/t";

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

const STATUS_TONE: Record<string, string> = {
  approved: "bg-success/10 text-success",
  for_review: "bg-warning/10 text-warning",
  superseded: "bg-gray-200 text-gray-700",
  rejected: "bg-danger/10 text-danger",
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
  const inputCls = "w-full rounded-md border border-border bg-surface px-2 py-2 text-sm";
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-ink"><T>Generated documents</T></h2>
      <p className="mt-1 text-sm text-muted">
        <T>ITP PDFs, inspection reports, IRNs, NCRs, FAT reports and Data Books filed by the platform. Newest first. Links are short-lived; reload the page for a fresh one.</T>
      </p>

      <form method="get" className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search title" className={inputCls} aria-label="Search" />
        <select name="project" defaultValue={sp.project === "all" ? "all" : (selectedProject ?? "")} className={inputCls} aria-label="Project">
          <option value="all"><T>All projects</T></option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_number} - {p.name}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={sp.type ?? ""} className={inputCls} aria-label="Type">
          <option value=""><T>All types</T></option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} className={inputCls} aria-label="Status">
          <option value=""><T>Any status</T></option>
          <option value="for_review"><T>For review</T></option>
          <option value="approved"><T>Approved</T></option>
          <option value="superseded"><T>Superseded</T></option>
          <option value="rejected"><T>Rejected</T></option>
        </select>
        <input type="date" name="from" defaultValue={sp.from ?? ""} className={inputCls} aria-label="From date" />
        <input type="date" name="to" defaultValue={sp.to ?? ""} className={inputCls} aria-label="To date" />
        <div className="flex gap-2 sm:col-span-3 lg:col-span-6">
          <button type="submit" className="rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white">
            <T>Apply filters</T>
          </button>
          <Link href="/inspect/reports-documents?project=all" className="rounded-md border border-border px-4 py-2 text-sm text-ink">
            <T>Reset</T>
          </Link>
        </div>
      </form>

      {docs.rows.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          <T>No generated documents match. Documents appear here automatically once a PDF is requested from an ITP, inspection, NCR, FAT or Data Book.</T>
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {docs.rows.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{d.title}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {d.projectLabel} - {new Date(d.createdAt).toLocaleDateString()}
                </p>
                <div className="mt-1 flex flex-wrap gap-1 text-xs">
                  <span className="rounded bg-off-white px-2 py-0.5 text-ink">{d.typeLabel}</span>
                  <span className="rounded bg-off-white px-2 py-0.5 text-ink"><T>Rev</T> {d.revision}</span>
                  <span className={`rounded px-2 py-0.5 ${STATUS_TONE[d.status] ?? "bg-gray-100 text-gray-700"}`}>
                    {d.status.replace("_", " ")}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 gap-2 text-sm">
                {d.url ? (
                  <>
                    <a href={d.url} target="_blank" rel="noreferrer" className="rounded-md border border-border px-3 py-2 text-burgundy">
                      <T>View</T>
                    </a>
                    <a href={d.url} download className="rounded-md border border-border px-3 py-2 text-burgundy">
                      <T>Download</T>
                    </a>
                  </>
                ) : (
                  <span className="text-xs text-muted"><T>File unavailable</T></span>
                )}
                {d.projectId && (
                  <Link
                    href={`/inspect/vault/${d.projectId}/document/${d.id}`}
                    className="rounded-md border border-border px-3 py-2 text-ink"
                  >
                    <T>Open</T>
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm">
          {docs.page > 1 ? (
            <Link href={pageHref(sp, docs.page - 1)} className="text-burgundy hover:underline">
              <T>Previous</T>
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            <T>Page</T> {docs.page} <T>of</T> {lastPage} ({docs.total} <T>documents)</T>
          </span>
          {docs.page < lastPage ? (
            <Link href={pageHref(sp, docs.page + 1)} className="text-burgundy hover:underline">
              <T>Next</T>
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </section>
  );
}
