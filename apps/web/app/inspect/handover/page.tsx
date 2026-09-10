import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { HANDOVER_CERTIFICATES_TABLE } from "@/lib/databook/types";
import { AcknowledgeForm } from "./acknowledge-form";

interface HandoverRow {
  id: string;
  certificate_number: string;
  issued_date: string;
  received_by_name: string | null;
  received_by_company: string | null;
  acknowledged_at: string | null;
  data_books: {
    book_number: string;
    title: string;
    projects: { name: string; project_number: string; organizations: { name: string } | null } | null;
  } | null;
}

// Handover Portal (Part C): softer, still-branded client-facing view of every handover certificate
// the signed-in user's access reaches — has_org_access-gated via handover_certificates_select, so a
// client only ever sees their own organisation's issued packages. No live PDF exists yet (that's a
// worker job outside this module's scope), so the download slot always reads "Not yet available"
// rather than linking to a file that isn't there.
export default async function HandoverPage() {
  await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: certificates } = await supabase
    .from(HANDOVER_CERTIFICATES_TABLE)
    .select(
      "id, certificate_number, issued_date, received_by_name, received_by_company, acknowledged_at, data_books(book_number, title, projects(name, project_number, organizations(name)))"
    )
    .order("issued_date", { ascending: false })
    .returns<HandoverRow[]>();

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-ink">Handover Portal</h1>
      <p className="mt-1 text-sm text-muted">
        Issued Data Books and handover certificates for the projects you have access to.
      </p>

      <div className="mt-6 space-y-4">
        {(certificates ?? []).map((cert) => (
          // Certificate-card layout, echoing the inspection record header band for a consistent
          // "official document" feel across the app.
          <div key={cert.id} className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex flex-wrap items-start justify-between gap-4 bg-burgundy px-5 py-4 text-white">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/70">Handover Certificate</p>
                <h2 className="doc-id text-xl font-semibold">{cert.certificate_number}</h2>
              </div>
              <Badge tone={cert.acknowledged_at ? "success" : "warning"}>
                {cert.acknowledged_at ? "Acknowledged" : "Awaiting acknowledgment"}
              </Badge>
            </div>

            <div className="px-5 py-4">
              <p className="text-base font-medium text-ink">
                {cert.data_books?.book_number} — {cert.data_books?.title}
              </p>
              <p className="mt-1 text-sm text-muted">
                {cert.data_books?.projects?.organizations?.name} · {cert.data_books?.projects?.name} (
                {cert.data_books?.projects?.project_number}) · Issued{" "}
                {new Date(cert.issued_date).toLocaleDateString()}
              </p>
              <p className="mt-2 text-sm text-muted">Package: Not yet available</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-off-white px-5 py-3">
              {cert.acknowledged_at ? (
                <p className="text-sm text-success">
                  Acknowledged by {cert.received_by_name ?? "—"}
                  {cert.received_by_company ? `, ${cert.received_by_company}` : ""} on{" "}
                  {new Date(cert.acknowledged_at).toLocaleDateString()}
                </p>
              ) : (
                <AcknowledgeForm certificateId={cert.id} />
              )}
            </div>
          </div>
        ))}

        {(certificates ?? []).length === 0 && (
          <p className="text-sm text-muted">No handover packages have been issued yet.</p>
        )}
      </div>
    </div>
  );
}
