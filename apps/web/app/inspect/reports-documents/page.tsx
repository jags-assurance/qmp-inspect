import Link from "next/link";
import { T } from "@/components/domain/t";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProjectPickerForm, type ProjectOption } from "../vault/project-picker-form";
import { DocumentsSection, loadDocuments, type DocSearchParams } from "./documents-section";
import { PageGuide } from "@/components/domain/page-guide";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { FilterBar } from "@/components/ui/toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import { getTranslator } from "@/lib/i18n/server";
import { withActiveProject } from "@/lib/projects/active-project";
import { getActiveProjectId } from "@/lib/projects/active-project-server";

/**
 * Cross-project entry point for the four per-project "read about progress" pages (Reports &
 * Downloads, Data Book, Activity, Client KPIs — the same four grouped into "Reports & Analytics"
 * on each project's own hub page). None of them has a meaningful top-level href without a project
 * already chosen, so this page IS the sidebar destination: pick a project here (same project-
 * filter pattern app/inspect/vault/page.tsx already uses, project-picker-form.tsx reused as-is),
 * then jump straight into any of its four pages. RLS on each destination page still decides what
 * that login actually sees — this is purely a navigation aggregator, unconditional on any module
 * license or role, same as "Projects" itself.
 *
 * The Handover Portal (/inspect/handover) is also surfaced from here, not project-scoped, since a
 * handover certificate is itself a kind of report/document — it used to be its own confusing
 * top-level nav item alongside this one (see app/inspect/layout.tsx's nav array); it now lives only
 * here, one level down, with the route itself unchanged so every existing "/inspect/handover" link
 * elsewhere in the app (e.g. the Data Book page's "Issue Handover" follow-up link) still works.
 */
export default async function ReportsDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<DocSearchParams>;
}) {
  const tl = await getTranslator();
  const session = await requireSession();
  const sp = withActiveProject(await searchParams, await getActiveProjectId());
  const projectId = sp.project === "all" ? undefined : sp.project;
  const supabase = await createSupabaseServerClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_number, name")
    .order("created_at", { ascending: false })
    .returns<ProjectOption[]>();

  const selectedProject = projectId ?? projects?.[0]?.id ?? null;
  const selectedProjectRow = (projects ?? []).find((p) => p.id === selectedProject) ?? null;

  // Handover "needs attention", scoped to the SELECTED project and split by role: staff see books
  // waiting to be issued and certificates awaiting the client; client users see "Acknowledge receipt";
  // contractors / TPI see nothing.
  const isClientRole = !session.isJagsStaff && session.grants.some((g) => g.role === "client");
  const attention: { key: string; href: string; label: string }[] = [];
  try {
    if (!selectedProject || (!session.isJagsStaff && !isClientRole)) throw new Error("no panel");
    const { data: books } = await supabase
      .from("data_books")
      .select("id, project_id, book_number, status, handover_certificates(acknowledged_at)")
      .eq("project_id", selectedProject)
      .in("status", ["compiled", "issued"])
      .returns<
        {
          id: string;
          project_id: string;
          book_number: string;
          status: string;
          handover_certificates: { acknowledged_at: string | null }[] | { acknowledged_at: string | null } | null;
        }[]
      >();
    for (const b of books ?? []) {
      const certs = Array.isArray(b.handover_certificates)
        ? b.handover_certificates
        : b.handover_certificates
          ? [b.handover_certificates]
          : [];
      if (b.status === "compiled" && session.isJagsStaff) {
        attention.push({
          key: b.id,
          href: `/inspect/projects/${b.project_id}/data-book`,
          label: `Data Book ${b.book_number} is compiled and waiting to be issued`,
        });
      } else if (b.status === "issued" && certs.length > 0 && certs.every((c) => !c.acknowledged_at)) {
        if (isClientRole) {
          attention.push({ key: b.id, href: "/inspect/handover", label: `Acknowledge receipt of Data Book ${b.book_number}` });
        } else if (session.isJagsStaff) {
          attention.push({
            key: b.id,
            href: "/inspect/handover",
            label: `Data Book ${b.book_number} is awaiting client acknowledgement`,
          });
        }
      }
    }
  } catch {
    // Panel is a convenience; never block the hub.
  }

  const docs = await loadDocuments(supabase, sp, selectedProject);

  return (
    <div className="space-y-5">
      <PageHeader
        className="mb-0"
        backHref={selectedProject ? `/inspect/projects/${selectedProject}` : undefined}
        backLabel="Back to Project"
        title={<T>Reports &amp; Documents</T>}
        subtitle={<T>Pick a project below.</T>}
        guide={
          <PageGuide
            title={tl("Reports & Documents — how this works")}
            points={[
              "This page is purely a navigation hub — pick a project and it just links you into that project's own Reports, Data Book, Activity, KPIs and (JAGS staff only) Audit Log pages.",
              "Nothing here is filtered by module license or role beyond the project picker itself — each destination page applies its own RLS to decide what you actually see once you get there.",
              "\"Audit Log\" only appears for JAGS staff — it's not part of what a client or contractor can open.",
            ]}
          />
        }
      />

      {attention.length > 0 && (
        <div role="status" className="rounded-lg border border-warning/40 bg-warning-soft p-4">
          <p className="flex items-center gap-2 font-medium text-ink">
            <span aria-hidden="true" className="font-bold text-warning">!</span>
            <span><T>Needs attention (</T>{attention.length})</span>
          </p>
          <ul className="mt-1 text-sm">
            {attention.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="inline-flex min-h-9 items-center font-medium text-brand hover:underline [@media(pointer:coarse)]:min-h-11">
                  {a.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {projects && projects.length > 0 ? (
        <FilterBar search={<ProjectPickerForm projects={projects} selectedProject={selectedProject} />} />
      ) : (
        <div className="rounded-lg border border-border bg-surface shadow-xs">
          <EmptyState title={<T>No projects available to you yet.</T>} />
        </div>
      )}

      {selectedProject && selectedProjectRow && (
        <Section
          title={<T>Project reports</T>}
          description={
            <span className="[overflow-wrap:anywhere]">
              {selectedProjectRow.project_number} — {selectedProjectRow.name}
            </span>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <ReportsCard
              href={`/inspect/projects/${selectedProject}/reports`}
              title={tl("Reports & Downloads")}
              description="Monthly report packs and ITP documents."
            />
            <ReportsCard
              href={`/inspect/projects/${selectedProject}/data-book`}
              title={tl("Data Book")}
              description="Compile and issue the project's data book."
            />
            <ReportsCard
              href={`/inspect/projects/${selectedProject}/activity`}
              title={tl("Activity")}
              description="Live timeline for this project."
            />
            <ReportsCard
              href={`/inspect/projects/${selectedProject}/kpis`}
              title={tl("Client KPIs")}
              description="Pass rates and turnaround."
            />
            {session.isJagsStaff && (
              <ReportsCard
                href={`/inspect/projects/${selectedProject}/audit-log`}
                title={tl("Audit Log")}
                description="Who did what and when."
              />
            )}
            {(session.isJagsStaff || isClientRole) && (
              <ReportsCard
                href="/inspect/handover"
                title={tl("Handover Portal")}
                description="Issued handover certificates and Data Books."
              />
            )}
          </div>
        </Section>
      )}

      <DocumentsSection docs={docs} sp={sp} projects={projects ?? []} selectedProject={selectedProject} />
    </div>
  );
}

function ReportsCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="block min-h-11 rounded-lg border border-control-border bg-surface p-4 transition-colors hover:bg-surface-subtle"
    >
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </Link>
  );
}
