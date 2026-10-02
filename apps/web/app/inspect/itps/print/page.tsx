import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { PrintButton } from "./print-button";
import { ITP_PHASES, ITP_PHASE_LABEL, normalizeItpPhase } from "@/lib/itps/phase";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  under_review: "Under review",
  approved: "Approved",
  client_accepted: "Client accepted",
};

/**
 * R91 — the PDF half of "exportable ITP Register... to PDF and Excel" (the CSV/"Excel" half is
 * app/api/itps/export/route.ts). A dedicated print view rather than trying to make the paginated,
 * interactive register page itself printable — same filters, but every matching row on one page,
 * laid out for paper. The user's browser "Save as PDF" in the print dialog produces the actual PDF;
 * there's no per-ITP fixed layout to justify a new worker-rendered template for a register view.
 */
export default async function ItpRegisterPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ discipline?: string; project?: string; phase?: string; q?: string }>;
}) {
  await requireSession();
  const { discipline: disciplineId, project: projectId, phase: phaseParam, q } = await searchParams;
  const phase = phaseParam && (ITP_PHASES as readonly string[]).includes(phaseParam) ? normalizeItpPhase(phaseParam) : null;
  const supabase = await createSupabaseServerClient();

  let itpIdFilter: string[] | null = null;
  if (disciplineId) {
    const { data: taggedItems } = await supabase
      .from("itp_items")
      .select("section_id, itp_sections(itp_id)")
      .eq("discipline_id", disciplineId)
      .returns<{ section_id: string; itp_sections: { itp_id: string } | null }[]>();
    itpIdFilter = [...new Set((taggedItems ?? []).map((i) => i.itp_sections?.itp_id).filter((id): id is string => Boolean(id)))];
  }

  let query = supabase
    .from("itps")
    .select("itp_number, title, status, revision, phase, applicable_standard, projects(name, organizations(name))");

  if (itpIdFilter) {
    query = itpIdFilter.length === 0 ? query.eq("id", "00000000-0000-0000-0000-000000000000") : query.in("id", itpIdFilter);
  }
  if (projectId) query = query.eq("project_id", projectId);
  if (phase) query = query.eq("phase", phase);
  if (q) query = query.or(`itp_number.ilike.%${q}%,title.ilike.%${q}%`);

  const { data: itps } = await query
    .order("created_at", { ascending: false })
    .returns<
      {
        itp_number: string;
        title: string;
        status: string;
        revision: number;
        phase: string;
        applicable_standard: string | null;
        projects: { name: string; organizations: { name: string } | null } | null;
      }[]
    >();

  return (
    <div>
      <div className="no-print flex items-center justify-between">
        <Link href="/inspect/itps" className="text-sm text-burgundy hover:underline">
          ← Back to ITP Register
        </Link>
        <PrintButton />
      </div>

      <div className="print-area mt-6">
        <h1 className="text-xl font-semibold text-ink">ITP Register</h1>
        <p className="mt-1 text-xs text-muted">Generated {new Date().toLocaleString("en-GB")} · {itps?.length ?? 0} ITPs</p>
        <div className="overflow-x-auto"><table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted">
              <th className="py-2 pr-3">ITP Number</th>
              <th className="py-2 pr-3">Title</th>
              <th className="py-2 pr-3">Client</th>
              <th className="py-2 pr-3">Project</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Phase</th>
              <th className="py-2 pr-3">Rev</th>
              <th className="py-2 pr-3">Applicable Standard</th>
            </tr>
          </thead>
          <tbody>
            {(itps ?? []).map((itp) => (
              <tr key={itp.itp_number} className="border-b border-border/50">
                <td className="doc-id py-2 pr-3">{itp.itp_number}</td>
                <td className="py-2 pr-3">{itp.title}</td>
                <td className="py-2 pr-3">{itp.projects?.organizations?.name ?? ""}</td>
                <td className="py-2 pr-3">{itp.projects?.name ?? ""}</td>
                <td className="py-2 pr-3">{STATUS_LABEL[itp.status] ?? itp.status}</td>
                <td className="py-2 pr-3">{ITP_PHASE_LABEL[normalizeItpPhase(itp.phase)]}</td>
                <td className="py-2 pr-3">{itp.revision}</td>
                <td className="py-2 pr-3">{itp.applicable_standard ?? ""}</td>
              </tr>
            ))}
            {(itps ?? []).length === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-center text-muted">
                  No ITPs match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
