import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VAULT_DOCUMENTS_TABLE, VAULT_FOLDERS_TABLE, type VaultFolderRow } from "@/lib/vault/types";
import { ProjectPickerForm, type ProjectOption } from "./project-picker-form";
import { ConnectorsPanel } from "./connectors-panel";

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  await requireSession();
  const { project: projectId } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_number, name")
    .order("created_at", { ascending: false })
    .returns<ProjectOption[]>();

  const selectedProject = projectId ?? projects?.[0]?.id ?? null;

  let folders: (VaultFolderRow & { documentCount: number })[] = [];
  if (selectedProject) {
    const { data: folderRows } = await supabase
      .from(VAULT_FOLDERS_TABLE)
      .select("id, project_id, folder_key, name, created_at")
      .eq("project_id", selectedProject)
      .order("folder_key")
      .returns<VaultFolderRow[]>();

    const folderIds = (folderRows ?? []).map((f) => f.id);
    const { data: documentRows } = folderIds.length
      ? await supabase
          .from(VAULT_DOCUMENTS_TABLE)
          .select("folder_id")
          .in("folder_id", folderIds)
          .neq("status", "superseded")
          .returns<{ folder_id: string }[]>()
      : { data: [] as { folder_id: string }[] };

    const counts = new Map<string, number>();
    for (const row of documentRows ?? []) {
      counts.set(row.folder_id, (counts.get(row.folder_id) ?? 0) + 1);
    }

    folders = (folderRows ?? []).map((f) => ({ ...f, documentCount: counts.get(f.id) ?? 0 }));
  }

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold text-ink">Document Vault</h1>
        <p className="mt-1 text-sm text-muted">
          The controlled set of project documents, organised into fixed folders with revision
          tracking.
        </p>
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
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder) => (
            <Link
              key={folder.id}
              href={`/inspect/vault/${selectedProject}/${folder.id}`}
              className="rounded-lg border border-border bg-surface p-4 transition hover:border-burgundy"
            >
              <p className="font-medium text-ink">{folder.name}</p>
              <p className="mt-1 text-sm text-muted">
                {folder.documentCount} document{folder.documentCount === 1 ? "" : "s"}
              </p>
            </Link>
          ))}
        </div>
      )}

      <ConnectorsPanel />
    </div>
  );
}
