import Link from "next/link";
import { T } from "@/components/domain/t";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VAULT_DOCUMENTS_TABLE, VAULT_FOLDERS_TABLE, type VaultFolderRow } from "@/lib/vault/types";
import { ProjectPickerForm, type ProjectOption } from "./project-picker-form";
import { AddCategoryForm } from "./add-category-form";
import { ConnectorsPanel } from "./connectors-panel";
import { PageGuide } from "@/components/domain/page-guide";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { getTranslator } from "@/lib/i18n/server";
import { withActiveProject } from "@/lib/projects/active-project";
import { getActiveProjectId } from "@/lib/projects/active-project-server";
import { buttonVariants } from "@/components/ui/button";

interface DocSummary {
  id: string;
  folder_id: string;
  title: string;
  revision: string;
  status: string;
  created_at: string;
}

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const tl = await getTranslator();
  const session = await requireSession();
  const { project: projectId } = withActiveProject(await searchParams, await getActiveProjectId());
  const supabase = await createSupabaseServerClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_number, name")
    .order("created_at", { ascending: false })
    .limit(500) // picker options only; a portfolio beyond this uses ?project=
    .returns<ProjectOption[]>();

  const selectedProject = projectId || projects?.[0]?.id || null;

  let folders: (VaultFolderRow & { documentCount: number })[] = [];
  let canManageCategories = false;
  let pendingCount = 0;
  let totalDocs = 0;
  let recent: DocSummary[] = [];
  const pendingByFolder = new Map<string, number>();
  let folderNameById = new Map<string, string>();
  if (selectedProject) {
    if (isAdminStaff(session)) {
      canManageCategories = true;
    } else {
      const { data: proj } = await supabase
        .from("projects")
        .select("organizations(engagement_scope)")
        .eq("id", selectedProject)
        .maybeSingle<{ organizations: { engagement_scope: string } | null }>();
      const scope = proj?.organizations?.engagement_scope;
      canManageCategories = scope === "self_managed" || scope === "client_managed";
    }
    const { data: folderRows } = await supabase
      .from(VAULT_FOLDERS_TABLE)
      .select("id, project_id, folder_key, name, created_at")
      .eq("project_id", selectedProject)
      .order("folder_key")
      .returns<VaultFolderRow[]>();

    const folderIds = (folderRows ?? []).map((f) => f.id);
    // Counts need every non-superseded document but only two narrow columns, read in pages (a plain
    // select stops silently at 1000 rows and used to drag the full row of every document along); the
    // "recent" strip is its own 5-row query.
    const [countRows, { data: recentRows }] = folderIds.length
      ? await Promise.all([
          fetchAll<{ id: string; folder_id: string; status: string }>((from, to) =>
            supabase
              .from(VAULT_DOCUMENTS_TABLE)
              .select("id, folder_id, status")
              .in("folder_id", folderIds)
              .neq("status", "superseded")
              .order("id")
              .range(from, to)
              .returns<{ id: string; folder_id: string; status: string }[]>()
          ),
          supabase
            .from(VAULT_DOCUMENTS_TABLE)
            .select("id, folder_id, title, revision, status, created_at")
            .in("folder_id", folderIds)
            .neq("status", "superseded")
            .order("created_at", { ascending: false })
            .limit(5)
            .returns<DocSummary[]>(),
        ])
      : [[] as { id: string; folder_id: string; status: string }[], { data: [] as DocSummary[] }];

    const counts = new Map<string, number>();
    for (const row of countRows) {
      counts.set(row.folder_id, (counts.get(row.folder_id) ?? 0) + 1);
      if (row.status === "for_review") {
        pendingCount += 1;
        pendingByFolder.set(row.folder_id, (pendingByFolder.get(row.folder_id) ?? 0) + 1);
      }
    }
    recent = recentRows ?? [];
    totalDocs = countRows.length;
    folderNameById = new Map((folderRows ?? []).map((f) => [f.id, f.name] as const));

    folders = (folderRows ?? []).map((f) => ({ ...f, documentCount: counts.get(f.id) ?? 0 }));
  }

  return (
    <div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-ink"><T>Document Vault</T></h1>
          <PageGuide
            title={tl("Document Vault — how this works")}
            points={[
              "Every project gets the same fixed set of 12 folders automatically — pick a project above, then open a folder to see its documents.",
              "Uploading a file whose document reference matches one already in that folder doesn't overwrite it — the old row is marked superseded and stays visible, nothing is silently lost.",
              "A newly uploaded document starts at status \"for review\" — a JAGS Admin, or anyone granted the approve_vault_document permission for that project, has to approve it before it counts as the controlled baseline.",
              "Every upload also gets a real document number stamped by the numbering engine, and its text is extracted in the background so it can later be used as source input for AI-drafted ITPs.",
            ]}
          />
        </div>
      </div>

      <ProjectPickerForm projects={projects ?? []} selectedProject={selectedProject} />

      {!selectedProject && (
        <p className="mt-8 text-sm text-muted">
          {projects && projects.length === 0
            ? "You don't have access to any projects yet."
            : "Select a project to view its document vault."}
        </p>
      )}

      {selectedProject && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href={`/inspect/vault/${selectedProject}/pending`}
              className={buttonVariants({ variant: "outline" })}
            >
              <T>My pending approvals</T>
            </Link>
            {totalDocs === 0 ? (
              <span
                aria-disabled="true"
                title="Nothing to download yet"
                className="inline-flex min-h-11 cursor-not-allowed items-center rounded-md border border-border bg-off-white px-3 py-2 text-sm font-medium text-muted"
              >
                <T>Download approved (.zip)</T>
              </span>
            ) : (
              <a
                href={`/api/vault/${selectedProject}/download-all`}
                className={buttonVariants({ variant: "outline" })}
              >
                <T>Download approved (.zip)</T>
              </a>
            )}
            <span className="text-sm text-muted">
              {totalDocs === 0 ? <T>No documents yet. Upload one into a folder below.</T> : <>{totalDocs} <T>current document</T>{totalDocs === 1 ? "" : "s"} · {pendingCount} <T>awaiting approval</T></>}
            </span>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((folder) => (
              <Link
                key={folder.id}
                href={`/inspect/vault/${selectedProject}/${folder.id}`}
                className="rounded-lg border border-border bg-surface p-4 transition hover:border-burgundy"
              >
                <p className="font-medium text-ink">
                  {folder.name}
                  {folder.is_custom && <span className="ms-1.5 text-xs font-normal text-muted"><T>(custom)</T></span>}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {folder.documentCount} <T>document</T>{folder.documentCount === 1 ? "" : "s"}
                  {(pendingByFolder.get(folder.id) ?? 0) > 0 && (
                    <span className="ms-2 text-warning">{pendingByFolder.get(folder.id)} <T>for review</T></span>
                  )}
                </p>
              </Link>
            ))}
          </div>
          {recent.length > 0 && (
            <section className="mt-8" aria-label={tl("Recently added")}>
              <h2 className="text-sm font-semibold text-ink"><T>Recently added</T></h2>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface text-sm">
                {recent.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/inspect/vault/${selectedProject}/${d.folder_id}?doc=${d.id}`}
                      className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 hover:bg-off-white"
                    >
                      <span className="min-w-0 flex-1 truncate text-ink">{d.title}</span>
                      <span className="text-xs text-muted">
                        {folderNameById.get(d.folder_id)} <T>· Rev</T> {d.revision} · {d.status.replace("_", " ")} ·{" "}
                        {new Date(d.created_at).toLocaleDateString("en-GB")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {canManageCategories && <AddCategoryForm projectId={selectedProject} />}
        </>
      )}

      <ConnectorsPanel />
    </div>
  );
}
