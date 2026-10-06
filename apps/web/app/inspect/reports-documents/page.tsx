import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProjectPickerForm, type ProjectOption } from "../vault/project-picker-form";
import { DocumentsSection, loadDocuments, type DocSearchParams } from "./documents-section";
import { PageGuide } from "@/components/domain/page-guide";

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
  const session = await requireSession();
  const sp = await searchParams;
  const projectId = sp.project === "all" ? undefined : sp.project;
  const supabase = await createSupabaseServerClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_number, name")
    .order("created_at", { ascending: false })
    .returns<ProjectOption[]>();

  const selectedProject = projectId ?? projects?.[0]?.id ?? null;
  const selectedProjectRow = (projects ?? []).find((p) => p.id === selectedProject) ?? null;

  // Handover "needs attention": compiled books awaiting issue (staff) and issued certificates the
  // client has not yet acknowledged. RLS scopes both queries to what this login may see.
  const attention: { key: string; href: string; label: string }[] = [];
  try {
    const { data: books } = await supabase
      .from("data_books")
      .select("id, project_id, book_number, status, handover_certificates(acknowledged_at)")
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
        attention.push({
          key: b.id,
          href: "/inspect/handover",
          label: `Data Book ${b.book_number} was issued and is awaiting client acknowledgement`,
        });
      }
    }
  } catch {
    // Panel is a convenience; never block the hub.
  }

  const docs = await loadDocuments(supabase, sp, selectedProject);

  return (
    <div>
      {selectedProject && (
        <Link href={`/inspect/projects/${selectedProject}`} className="text-sm text-burgundy hover:underline">
          ← Back to Project
        </Link>
      )}
      <div className={selectedProject ? "mt-2" : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-ink">Reports &amp; Documents</h1>
          <PageGuide
            title="Reports & Documents — how this works"
            points={[
              "This page is purely a navigation hub — pick a project and it just links you into that project's own Reports, Data Book, Activity, KPIs and (JAGS staff only) Audit Log pages.",
              "Nothing here is filtered by module license or role beyond the project picker itself — each destination page applies its own RLS to decide what you actually see once you get there.",
              "\"Audit Log\" only appears for JAGS staff — it's not part of what a client or contractor can open.",
            ]}
          />
        </div>
        <p className="mt-1 text-sm text-muted">
          Reports &amp; downloads, the Data Book, project activity and Client KPIs — pick a project below.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ReportsCard
          href="/inspect/handover"
          title="Handover Portal"
          description="Issued handover certificates and Data Book packages, across every project."
        />
      </div>

      {attention.length > 0 && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium text-ink">Needs attention ({attention.length})</p>
          <ul className="mt-2 space-y-1 text-sm">
            {attention.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="text-burgundy hover:underline">
                  {a.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DocumentsSection docs={docs} sp={sp} projects={projects ?? []} selectedProject={selectedProject} />

      {projects && projects.length > 0 ? (
        <ProjectPickerForm projects={projects} selectedProject={selectedProject} />
      ) : (
        <p className="mt-6 text-sm text-muted">No projects available to you yet.</p>
      )}

      {selectedProject && selectedProjectRow && (
        <div className="mt-6">
          <p className="text-sm text-muted">
            {selectedProjectRow.project_number} — {selectedProjectRow.name}
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ReportsCard
              href={`/inspect/projects/${selectedProject}/reports`}
              title="Reports & Downloads"
              description="Monthly report packs and ITP documents for your organisation."
            />
            <ReportsCard
              href={`/inspect/projects/${selectedProject}/data-book`}
              title="Data Book"
              description="Compile and issue the project's data book."
            />
            <ReportsCard
              href={`/inspect/projects/${selectedProject}/activity`}
              title="Activity"
              description="A live timeline of inspections, sign-offs and NCRs on this project."
            />
            <ReportsCard
              href={`/inspect/projects/${selectedProject}/kpis`}
              title="Client KPIs"
              description="First-time pass rate, hold-point turnaround and more."
            />
            {session.isJagsStaff && (
              <ReportsCard
                href={`/inspect/projects/${selectedProject}/audit-log`}
                title="Audit Log"
                description="Who did what and when, across ITPs, NCRs, sign-offs and inspections."
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReportsCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-burgundy hover:bg-off-white"
    >
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </Link>
  );
}
