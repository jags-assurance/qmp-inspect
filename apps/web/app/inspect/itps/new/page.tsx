import { redirect } from "next/navigation";
import Link from "next/link";
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
import { isAiConfigured } from "@/lib/ai/gate";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";

export default async function NewItpPage() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // Client- or contractor-created ITPs (opt-in per project — client:
  // supabase/migrations/20260918000000_client_itp_creation.sql, or org-wide for a Self-Managed/
  // Platform-Only client, 20260918010000_self_managed_engagement_scope.sql; subcontractor/
  // main_contractor: 20260919000000_contractor_itp_creation.sql): a non-staff user only gets past
  // this gate if their login is linked to an active, eligible project_party on at least one project.
  // Mirrors is_client_itp_creator() exactly so the page and the RLS it relies on never drift apart.
  let clientEligibleProjectIds: Set<string> | null = null;
  if (!session.isJagsStaff) {
    const { data: eligibleParties } = await supabase
      .from("project_parties")
      .select(
        "project_id, party_type, projects!inner(allow_client_itp_creation, allow_contractor_itp_creation, organizations(engagement_scope))"
      )
      .in("party_type", ["client", "subcontractor", "main_contractor"])
      .eq("is_active", true)
      .eq("user_id", session.userId)
      .returns<
        {
          project_id: string;
          party_type: "client" | "subcontractor" | "main_contractor";
          projects: {
            allow_client_itp_creation: boolean;
            allow_contractor_itp_creation: boolean;
            organizations: { engagement_scope: string } | null;
          } | null;
        }[]
      >();

    clientEligibleProjectIds = new Set(
      (eligibleParties ?? [])
        .filter((p) =>
          p.party_type === "client"
            ? p.projects?.allow_client_itp_creation || p.projects?.organizations?.engagement_scope === "self_managed"
            : p.projects?.allow_contractor_itp_creation
        )
        .map((p) => p.project_id)
    );
    if (clientEligibleProjectIds.size === 0) redirect("/inspect/itps");
  }

  const [{ data: allProjects }, { data: templates }, disciplines, { data: vaultDocumentRows }] = await Promise.all([
    supabase.from("projects").select("id, project_number, name").order("name"),
    supabase
      .from(ITP_MASTER_TEMPLATES_TABLE)
      .select("id, title, industry, version")
      .eq("is_active", true)
      .order("title")
      .returns<{ id: string; title: string; industry: string; version: number }[]>(),
    getActiveMasterDisciplines(),
    // For the "generate from vault documents" tab's document picker — the real source material an
    // ITP draft is grounded in (see new-itp-from-ai-form.tsx). Scoped by RLS to projects this user
    // has access to; fetched unconditionally here (not per-project) since the project picker lives
    // client-side in that form. extraction_status lets the picker show which documents actually
    // have usable text without exposing extracted_text itself to the client.
    supabase
      .from(VAULT_DOCUMENTS_TABLE)
      .select(
        "id, title, notes, document_number, document_reference, revision, extraction_status, vault_folders(project_id, name)"
      )
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
          extraction_status: string;
          vault_folders: { project_id: string; name: string } | null;
        }[]
      >(),
  ]);

  const vaultDocuments: VaultDocumentOption[] = (vaultDocumentRows ?? [])
    .filter((d) => d.vault_folders?.project_id)
    .map((d) => ({
      id: d.id,
      projectId: d.vault_folders!.project_id,
      folderName: d.vault_folders!.name,
      title: d.title,
      notes: d.notes,
      documentNumber: d.document_number,
      documentReference: d.document_reference,
      revision: d.revision,
      extractionStatus: d.extraction_status,
    }));

  // A client-eligible non-staff user only ever sees their own opted-in project(s). Both the manual
  // "build from scratch" flow and the AI-draft-from-vault-documents flow are available to them —
  // neither generateItpDraftAction nor createItpFromDraftAction (lib/itps/ai-draft-actions.ts) has
  // any staff-only check; both already rely purely on RLS (is_client_itp_creator, same as the
  // manual flow), so this was a UI-only gap, not a permissions one. The master-template copy flow
  // stays staff-only for now — a bigger surface area (org-wide template library curation) that
  // wasn't part of this specific ask.
  const projects = clientEligibleProjectIds
    ? (allProjects ?? []).filter((p) => clientEligibleProjectIds!.has(p.id))
    : (allProjects ?? []);

  // R43 — hide the AI entry point entirely when this deployment has no AI provider key configured,
  // rather than showing a tab that can only ever fail after submit.
  const aiConfigured = isAiConfigured();
  const fromAi = aiConfigured ? (
    <NewItpFromAiForm projects={projects} vaultDocuments={vaultDocuments} disciplines={disciplines ?? []} />
  ) : undefined;

  if (clientEligibleProjectIds) {
    return (
      <div className="max-w-3xl">
        <Link href="/inspect/itps" className="text-sm text-burgundy hover:underline">
          ← Back to ITP Register
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">New ITP</h1>
        <p className="mt-1 text-sm text-muted">
          Creates a draft ITP with the four standard sections — add, rename or reorder them as
          needed once it&apos;s created.
          {aiConfigured ? " Or generate a first draft from your own vault documents." : ""} JAGS will
          review and approve it once you submit it.
        </p>
        <ItpCreationTabs manual={<NewItpForm projects={projects} />} fromAi={fromAi} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Link href="/inspect/itps" className="text-sm text-burgundy hover:underline">
        ← Back to ITP Register
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-ink">New ITP</h1>
      <p className="mt-1 text-sm text-muted">
        Creates a draft ITP with the four standard sections — add, rename or reorder them as
        needed once it&apos;s created. Or start from a JAGS master template and customize it for
        this project.
      </p>
      <ItpCreationTabs
        manual={<NewItpForm projects={projects} />}
        fromTemplate={<NewItpFromTemplateForm projects={projects} templates={templates ?? []} />}
        fromAi={fromAi}
      />
    </div>
  );
}
