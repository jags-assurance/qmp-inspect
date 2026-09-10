import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ITP_MASTER_TEMPLATES_TABLE } from "@/lib/itp-master/types";
import { NewItpForm } from "./new-itp-form";
// Added for the "start from a master template" option (Reqs R31) — the manual flow above is
// otherwise untouched.
import { NewItpFromTemplateForm } from "./new-itp-from-template-form";
// Added for the "generate from a spec description" option (Reqs R34-R43) — the manual and
// from-template flows above are otherwise untouched.
import { NewItpFromAiForm, type VaultDocumentOption } from "./new-itp-from-ai-form";
import { ItpCreationTabs } from "./itp-creation-tabs";
import { VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";

export default async function NewItpPage() {
  const session = await requireSession();
  if (!session.isJagsStaff) redirect("/inspect/itps");

  const supabase = await createSupabaseServerClient();
  const [{ data: projects }, { data: templates }, { data: vaultDocumentRows }] = await Promise.all([
    supabase.from("projects").select("id, project_number, name").order("name"),
    supabase
      .from(ITP_MASTER_TEMPLATES_TABLE)
      .select("id, title, industry, version")
      .eq("is_active", true)
      .order("title")
      .returns<{ id: string; title: string; industry: string; version: number }[]>(),
    // For the "generate from a spec description" tab's optional document picker (attaches a vault
    // document's own metadata as extra text context — never its file content, see
    // new-itp-from-ai-form.tsx). Scoped by RLS to projects this user has access to; fetched
    // unconditionally here (not per-project) since the project picker lives client-side in that form.
    supabase
      .from(VAULT_DOCUMENTS_TABLE)
      .select("id, title, notes, document_number, document_reference, revision, vault_folders(project_id)")
      .neq("status", "superseded")
      .order("title")
      .returns<
        {
          id: string;
          title: string;
          notes: string | null;
          document_number: string | null;
          document_reference: string | null;
          revision: string;
          vault_folders: { project_id: string } | null;
        }[]
      >(),
  ]);

  const vaultDocuments: VaultDocumentOption[] = (vaultDocumentRows ?? [])
    .filter((d) => d.vault_folders?.project_id)
    .map((d) => ({
      id: d.id,
      projectId: d.vault_folders!.project_id,
      title: d.title,
      notes: d.notes,
      documentNumber: d.document_number,
      documentReference: d.document_reference,
      revision: d.revision,
    }));

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold text-ink">New ITP</h1>
      <p className="mt-1 text-sm text-muted">
        Creates a draft ITP with the four standard sections — add, rename or reorder them as
        needed once it&apos;s created. Or start from a JAGS master template and customize it for
        this project.
      </p>
      <ItpCreationTabs
        manual={<NewItpForm projects={projects ?? []} />}
        fromTemplate={<NewItpFromTemplateForm projects={projects ?? []} templates={templates ?? []} />}
        fromAi={<NewItpFromAiForm projects={projects ?? []} vaultDocuments={vaultDocuments} />}
      />
    </div>
  );
}
