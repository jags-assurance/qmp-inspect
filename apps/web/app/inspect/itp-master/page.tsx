import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ITP_MASTER_TEMPLATES_TABLE } from "@/lib/itp-master/types";
import { TemplatesTable, type MasterTemplateRow } from "./templates-table";
import { PageGuide } from "@/components/domain/page-guide";

// Tier 1 master library is JAGS-staff-only at every level (RLS-enforced) — this redirect is a UX
// nicety, not the actual boundary; a non-staff user's query would come back empty regardless.
export default async function ItpMasterLibraryPage() {
  const session = await requireSession();
  if (!session.isJagsStaff) redirect("/inspect/itps");

  const supabase = await createSupabaseServerClient();
  const { data: templates } = await supabase
    .from(ITP_MASTER_TEMPLATES_TABLE)
    .select("id, title, industry, version, is_active, master_disciplines(name)")
    .order("title")
    .returns<MasterTemplateRow[]>();

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">Master ITP Library</h1>
            <PageGuide
              title="Master ITP Library — how this works"
              points={[
                "JAGS-staff-only at every level — RLS-enforced, not just a UI redirect; a client or contractor login can never see this library or its templates.",
                "These are reusable templates JAGS builds up across projects, never shown to clients directly — a project's own ITP is created FROM one, then customised.",
                "Content only enters the library through the proposal-approval flow: a JAGS Admin reviews a proposal (raised from an approved/client-accepted project ITP) before it becomes, or updates, a master template.",
                "Each template keeps a version history — see a template's own page for its past revisions as frozen snapshots.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            JAGS-internal ITP templates, built up across projects. Never visible to clients. Content
            only enters the library through an approved proposal.
          </p>
        </div>
        <Link
          href="/inspect/itp-master/proposals"
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
        >
          Review proposals →
        </Link>
      </div>

      <div className="mt-6">
        <TemplatesTable rows={templates ?? []} />
      </div>
    </div>
  );
}
