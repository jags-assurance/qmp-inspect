import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ITP_MASTER_TEMPLATES_TABLE } from "@/lib/itp-master/types";
import { TemplatesTable, type MasterTemplateRow } from "./templates-table";
import { PageGuide } from "@/components/domain/page-guide";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";
import { buttonVariants } from "@/components/ui/button";

// Tier 1 master library is JAGS-staff-only at every level (RLS-enforced) — this redirect is a UX
// nicety, not the actual boundary; a non-staff user's query would come back empty regardless.
export default async function ItpMasterLibraryPage() {
  const tl = await getTranslator();
  const session = await requireSession();
  if (!session.isJagsStaff) redirect("/inspect/itps");

  const supabase = await createSupabaseServerClient();
  const { data: templates } = await supabase
    .from(ITP_MASTER_TEMPLATES_TABLE)
    .select("id, title, industry, version, is_active, master_disciplines(name)")
    .order("title")
    .returns<MasterTemplateRow[]>();

  const activeCount = (templates ?? []).filter((t) => t.is_active).length;
  const disciplineCount = new Set((templates ?? []).map((t) => t.master_disciplines?.name).filter(Boolean)).size;

  return (
    <div>
      <SettingsBackLink href="/inspect/settings?section=checklist-library" />
      <PageHeader
        className="mt-2"
        title={<T>Master ITP Library</T>}
        guide={
          <PageGuide
              title={tl("Master ITP Library — how this works")}
              points={[
                "JAGS-staff-only at every level — RLS-enforced, not just a UI redirect; a client or contractor login can never see this library or its templates.",
                "These are reusable templates JAGS builds up across projects, never shown to clients directly — a project's own ITP is created FROM one, then customised.",
                "Content only enters the library through the proposal-approval flow: a JAGS Admin reviews a proposal (raised from an approved/client-accepted project ITP) before it becomes, or updates, a master template.",
                "Each template keeps a version history — see a template's own page for its past revisions as frozen snapshots.",
              ]}
            />
        }
        subtitle={<T>JAGS-internal ITP templates, never shown to clients.</T>}
        primaryAction={
          <Link href="/inspect/itp-master/proposals" className={buttonVariants({ variant: "outline" })}>
            <T>Review proposals →</T>
          </Link>
        }
      />

      <StatGrid max={4}>
        <StatTile label="Templates" value={(templates ?? []).length} />
        <StatTile label="Active" value={activeCount} />
        <StatTile label="Inactive" value={(templates ?? []).length - activeCount} />
        <StatTile label="Disciplines covered" value={disciplineCount} />
      </StatGrid>

      <div className="mt-6">
        <TemplatesTable rows={templates ?? []} />
      </div>
    </div>
  );
}
