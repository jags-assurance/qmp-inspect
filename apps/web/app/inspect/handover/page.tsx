import { formatLocationForDisplay } from "@/lib/checklists/location";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { HANDOVER_CERTIFICATES_TABLE } from "@/lib/databook/types";
import { GENERATED_DOCUMENTS_BUCKET } from "@/lib/reports/types";
import { getSignedPhotoUrls } from "@/lib/storage/signed-urls";
import { AcknowledgeForm } from "./acknowledge-form";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { PageGuide } from "@/components/domain/page-guide";

interface HandoverRow {
  id: string;
  certificate_number: string;
  issued_date: string;
  received_by_name: string | null;
  received_by_company: string | null;
  acknowledged_at: string | null;
  package_storage_path: string | null;
  package_sha256: string | null;
  is_conditional: boolean;
  conditional_reason: string | null;
  conditional_open_items: { id: string; description: string; location: string | null; due_date: string | null; responsible_party_name: string | null }[] | null;
  data_books: {
    book_number: string;
    title: string;
    projects: { name: string; project_number: string; organizations: { name: string } | null } | null;
  } | null;
}

// Handover Portal (Part C): softer, still-branded client-facing view of every handover certificate
// the signed-in user's access reaches — has_org_access-gated via handover_certificates_select, so a
// client only ever sees their own organisation's issued packages. Every certificate issued since the
// package-integrity fix (see the "handover_certificate_package_integrity" migration) carries a real
// package_storage_path; a certificate with none is a pre-fix legacy row and gets a red warning
// banner rather than silently reading "Not yet available" as if that were normal.
export default async function HandoverPage() {
  await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: certificates } = await supabase
    .from(HANDOVER_CERTIFICATES_TABLE)
    .select(
      "id, certificate_number, issued_date, received_by_name, received_by_company, acknowledged_at, package_storage_path, package_sha256, is_conditional, conditional_reason, conditional_open_items, data_books(book_number, title, projects(name, project_number, organizations(name)))"
    )
    .order("issued_date", { ascending: false })
    .returns<HandoverRow[]>();

  // Perf fix: this used to be one createSignedUrl round trip PER certificate, serially — an org
  // with many issued handovers paid N sequential Storage calls on every page load. Batched via the
  // same getSignedPhotoUrls helper other photo/document surfaces already use (bucket-agnostic
  // despite the name — it just wraps Storage's own plural createSignedUrls).
  const pathToUrl = await getSignedPhotoUrls(
    supabase,
    GENERATED_DOCUMENTS_BUCKET,
    (certificates ?? []).map((c) => c.package_storage_path).filter((p): p is string => Boolean(p))
  );
  const packageLinks = new Map<string, string>();
  for (const cert of certificates ?? []) {
    const url = cert.package_storage_path ? pathToUrl.get(cert.package_storage_path) : undefined;
    if (url) packageLinks.set(cert.id, url);
  }

  return (
    <div className="max-w-3xl">
      <RealtimeRefresh table="handover_certificates" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-ink">Handover Portal</h1>
        <PageGuide
          title="Handover Portal — how this works"
          points={[
            "Each card is a certificate for a compiled Data Book that's been issued to your organisation — you only ever see certificates for your own org's projects.",
            "Acknowledging receipt is a client-side action: enter your name (and optionally company) and confirm — that timestamp becomes the formal record that you received the package.",
            "A \"Conditional\" badge means the handover was issued with open items still outstanding — they're listed on the card along with who owns each one and its agreed due date.",
            "The SHA-256 fingerprint next to the download link lets you verify any copy of the package you receive elsewhere is byte-for-byte the certified file.",
            "A red warning banner instead of a download link means no package file is attached to that certificate (a pre-fix legacy record) — contact JAGS Assurance rather than treat it as complete.",
          ]}
        />
      </div>
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
              <div className="flex items-center gap-2">
                {cert.is_conditional && <Badge tone="warning">Conditional</Badge>}
                <Badge tone={cert.acknowledged_at ? "success" : "warning"}>
                  {cert.acknowledged_at ? "Acknowledged" : "Awaiting acknowledgment"}
                </Badge>
              </div>
            </div>

            <div className="px-5 py-4">
              <p className="text-base font-medium text-ink">
                {cert.data_books?.book_number} — {cert.data_books?.title}
              </p>
              <p className="mt-1 text-sm text-muted">
                {cert.data_books?.projects?.organizations?.name} · {cert.data_books?.projects?.name} (
                {cert.data_books?.projects?.project_number}) · Issued{" "}
                {new Date(cert.issued_date).toLocaleDateString("en-GB")}
              </p>
              {cert.is_conditional && (
                <div className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-ink">
                  <p className="font-medium">
                    Conditional Handover — issued with open items outstanding.
                  </p>
                  {cert.conditional_reason && <p className="mt-1 text-xs">{cert.conditional_reason}</p>}
                  {cert.conditional_open_items && cert.conditional_open_items.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-xs">
                      {cert.conditional_open_items.map((item) => (
                        <li key={item.id}>
                          • {item.description}
                          {item.location ? ` (${formatLocationForDisplay(item.location)})` : ""} — {item.responsible_party_name ?? "unassigned"},
                          agreed due {item.due_date ? new Date(item.due_date).toLocaleDateString("en-GB") : "no date set"}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {packageLinks.has(cert.id) ? (
                <>
                  <p className="mt-2 text-sm">
                    <a href={packageLinks.get(cert.id)} className="font-medium text-burgundy hover:underline">
                      Download handover package →
                    </a>
                  </p>
                  {cert.package_sha256 && (
                    <p className="mt-1 font-mono text-xs text-muted" title="SHA-256 fingerprint of the exact certified file — compare this to any copy you receive elsewhere to verify it's unmodified.">
                      SHA-256: {cert.package_sha256}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                  ⚠ No package file is attached to this certificate. Contact JAGS Assurance to resolve
                  before relying on this handover as complete.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-off-white px-5 py-3">
              {cert.acknowledged_at ? (
                <p className="text-sm text-success">
                  Acknowledged by {cert.received_by_name ?? "—"}
                  {cert.received_by_company ? `, ${cert.received_by_company}` : ""} on{" "}
                  {new Date(cert.acknowledged_at).toLocaleDateString("en-GB")}
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
