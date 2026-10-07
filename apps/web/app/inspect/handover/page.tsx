import { formatLocationForDisplay } from "@/lib/checklists/location";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { HANDOVER_CERTIFICATES_TABLE } from "@/lib/databook/types";
import { GENERATED_DOCUMENTS_BUCKET } from "@/lib/reports/types";
import { getSignedPhotoUrls } from "@/lib/storage/signed-urls";
import { isModuleLicensed } from "@/lib/module-licensing/access";
import { isMissingDbObject, formatUtcDate, formatUtcDateTime } from "@/lib/databook/db-errors";
import { AcknowledgeForm } from "./acknowledge-form";
import { RejectForm, ReopenRejectionForm } from "./reject-form";
import { CertificatePdfButton } from "./certificate-pdf-button";
import { getHandoverCertificatePdfInfo } from "@/lib/handover/certificate-pdf";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { PageGuide } from "@/components/domain/page-guide";

interface HandoverRow {
  id: string;
  data_book_id: string;
  certificate_number: string;
  issued_date: string;
  received_by_name: string | null;
  received_by_company: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  acknowledged_by_role: string | null;
  acknowledged_on_behalf: boolean | null;
  package_storage_path: string | null;
  package_sha256: string | null;
  is_conditional: boolean;
  conditional_reason: string | null;
  conditional_open_items: { id: string; description: string; location: string | null; due_date: string | null; responsible_party_name: string | null }[] | null;
  // Columns added by 20261101000100 / 20261101000300 (absent until that migration is applied).
  notes?: string | null;
  superseded_at?: string | null;
  rendered_book_sha256?: string | null;
  verification_token?: string | null;
  ack_comment?: string | null;
  // Columns added by 20261108000102 (absent until applied).
  rejected_at?: string | null;
  rejection_reason?: string | null;
  // Columns added by 20261112000101 (absent until applied).
  ack_has_signature?: boolean | null;
  ack_evidence_path?: string | null;
  ack_evidence_name?: string | null;
  data_books: {
    project_id: string;
    book_number: string;
    title: string;
    projects: { name: string; project_number: string; organization_id: string; organizations: { name: string } | null } | null;
  } | null;
}

const PAGE_SIZE = 25;
const OPEN_ITEMS_SHOWN = 15;
// Package links are short-lived on purpose: a link pasted outside the app should stop working quickly.
const LINK_TTL_SECONDS = 600;

const BASE_COLUMNS =
  "id, data_book_id, certificate_number, issued_date, received_by_name, received_by_company, acknowledged_at, acknowledged_by, acknowledged_by_role, acknowledged_on_behalf, package_storage_path, package_sha256, is_conditional, conditional_reason, conditional_open_items, data_books(project_id, book_number, title, projects(name, project_number, organization_id, organizations(name)))";
const EXTRA_COLUMNS = "notes, superseded_at, rendered_book_sha256, verification_token, ack_comment";
const REJECT_COLUMNS = "rejected_at, rejection_reason";
const SIGNATURE_COLUMNS = "ack_has_signature, ack_evidence_path, ack_evidence_name";

// Handover Portal (Part C): softer, still-branded client-facing view of every handover certificate
// the signed-in user's access reaches. handover_certificates_select now limits reads to JAGS staff
// and client-role grants (can_read_handover), so a client only ever sees their own organisation's
// issued packages and a subcontractor / TPI sees none. Every certificate issued since the
// package-integrity fix (see the "handover_certificate_package_integrity" migration) carries a real
// package_storage_path; a certificate with none is a pre-fix legacy row and gets a red warning
// banner rather than silently reading "Not yet available" as if that were normal.
export default async function HandoverPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const session = await requireSession();
  const isClient = !session.isJagsStaff && session.grants.some((g) => g.role === "client");
  const onBehalfAllowed = isAdminStaff(session);
  // Handover certificates are a client-facing record: contractors, subcontractors and TPI/lab users
  // have no part in them, so they are sent back to the dashboard. JAGS staff can view all.
  if (!isClient && !session.isJagsStaff) redirect("/inspect");
  const supabase = await createSupabaseServerClient();

  const sp = await searchParams;
  const statusFilter = sp.status === "awaiting" || sp.status === "acknowledged" ? sp.status : "all";
  const q = (sp.q ?? "").trim().replace(/[,%()*]/g, " ").slice(0, 60);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  async function load(columns: string) {
    let query = supabase
      .from(HANDOVER_CERTIFICATES_TABLE)
      .select(columns, { count: "exact" })
      .order("issued_date", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (statusFilter === "awaiting") query = query.is("acknowledged_at", null);
    if (statusFilter === "acknowledged") query = query.not("acknowledged_at", "is", null);
    if (q) query = query.ilike("certificate_number", `%${q}%`);
    return query.returns<HandoverRow[]>();
  }
  // Newest schema first, then progressively older ones, so a pending migration never blanks the page.
  let { data: certificates, count, error: loadError } = await load(`${BASE_COLUMNS}, ${EXTRA_COLUMNS}, ${REJECT_COLUMNS}, ${SIGNATURE_COLUMNS}`);
  // The signature pad and evidence upload only appear once the signature columns exist (migration 20261112000101).
  const signatureEnabled = !loadError;
  if (loadError && isMissingDbObject(loadError)) {
    ({ data: certificates, count, error: loadError } = await load(`${BASE_COLUMNS}, ${EXTRA_COLUMNS}, ${REJECT_COLUMNS}`));
  }
  if (loadError && isMissingDbObject(loadError)) {
    ({ data: certificates, count, error: loadError } = await load(`${BASE_COLUMNS}, ${EXTRA_COLUMNS}`));
  }
  if (loadError && isMissingDbObject(loadError)) {
    ({ data: certificates, count, error: loadError } = await load(BASE_COLUMNS));
  }
  const rows = certificates ?? [];
  const total = count ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Module licence is per organisation: hide certificates of an org whose Data Book module is switched off (staff bypass).
  const orgIds = [...new Set(rows.map((c) => c.data_books?.projects?.organization_id).filter((v): v is string => Boolean(v)))];
  const unlicensedOrgs = new Set<string>();
  if (!session.isJagsStaff) {
    for (const orgId of orgIds) if (!(await isModuleLicensed(supabase, orgId, "data_book"))) unlicensedOrgs.add(orgId);
  }
  const certificatesShown = rows.filter((c) => !unlicensedOrgs.has(c.data_books?.projects?.organization_id ?? ""));

  // Who recorded each acknowledgement (display name) — one query for all certificates.
  const ackUserIds = [...new Set(certificatesShown.map((c) => c.acknowledged_by).filter((v): v is string => Boolean(v)))];
  const ackNames = new Map<string, string>();
  if (ackUserIds.length > 0) {
    const { data: users } = await supabase.from("users").select("id, full_name").in("id", ackUserIds).returns<{ id: string; full_name: string | null }[]>();
    for (const u of users ?? []) if (u.full_name) ackNames.set(u.id, u.full_name);
  }

  // Perf fix: this used to be one createSignedUrl round trip PER certificate, serially — an org
  // with many issued handovers paid N sequential Storage calls on every page load. Batched via the
  // same getSignedPhotoUrls helper other photo/document surfaces already use (bucket-agnostic
  // despite the name — it just wraps Storage's own plural createSignedUrls).
  const pathToUrl = await getSignedPhotoUrls(
    supabase,
    GENERATED_DOCUMENTS_BUCKET,
    certificatesShown.flatMap((c) => [c.package_storage_path, c.ack_evidence_path]).filter((p): p is string => Boolean(p)),
    LINK_TTL_SECONDS
  );
  const certPdfInfo = await getHandoverCertificatePdfInfo(supabase, certificatesShown.map((c) => c.data_book_id));
  const packageLinks = new Map<string, string>();
  for (const cert of certificatesShown) {
    const url = cert.package_storage_path ? pathToUrl.get(cert.package_storage_path) : undefined;
    if (url) packageLinks.set(cert.id, url);
  }

  const baseParams = (extra: Record<string, string>) => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (q) params.set("q", q);
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    const str = params.toString();
    return str ? `?${str}` : "?";
  };

  return (
    <div className="max-w-3xl">
      <RealtimeRefresh table="handover_certificates" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-ink">Handover Portal</h1>
        <PageGuide
          title="Handover Portal — how this works"
          points={[
            "Each card is a certificate for a compiled Data Book that's been issued to your organisation — you only ever see certificates for your own org's projects.",
            "Acknowledging receipt is a client-side action: enter your name (and optionally company), sign in the signature box, optionally attach a supporting file (for example a signed acceptance letter), add any comments, and confirm — that timestamp becomes the formal record that you received the package.",
            "A \"Conditional\" badge means the handover was issued with open items still outstanding — they're listed on the card along with who owns each one and its agreed due date.",
            "The SHA-256 fingerprint next to the download link lets you verify any copy of the package you receive elsewhere is byte-for-byte the certified file.",
            "A red warning banner instead of a download link means no package file is attached to that certificate (a pre-fix legacy record) — contact JAGS Assurance rather than treat it as complete.",
            "Download links are valid for 10 minutes; reload the page for a fresh one. Times are shown in UTC.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        Issued Data Books and handover certificates for the projects you have access to.
      </p>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="handover_status" className="block text-xs font-medium text-ink">
            Status
          </label>
          <select id="handover_status" name="status" defaultValue={statusFilter} className="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm">
            <option value="all">All</option>
            <option value="awaiting">Awaiting acknowledgement</option>
            <option value="acknowledged">Acknowledged</option>
          </select>
        </div>
        <div>
          <label htmlFor="handover_q" className="block text-xs font-medium text-ink">
            Certificate number
          </label>
          <input id="handover_q" name="q" defaultValue={q} className="mt-1 w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
        </div>
        <button type="submit" className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-off-white">
          Filter
        </button>
      </form>

      <div className="mt-6 space-y-4">
        {certificatesShown.map((cert) => {
          const pdfInfo = certPdfInfo.get(cert.data_book_id);
          // The certificate PDF is a snapshot: after an acknowledgement a render that predates it is stale.
          const pdfStale = Boolean(pdfInfo?.createdAt && cert.acknowledged_at && Date.parse(pdfInfo.createdAt) < Date.parse(cert.acknowledged_at));
          const openItems = cert.conditional_open_items ?? [];
          const projectId = cert.data_books?.project_id;
          return (
            // Certificate-card layout, echoing the inspection record header band for a consistent
            // "official document" feel across the app.
            <div key={cert.id} className="overflow-hidden rounded-lg border border-border bg-surface">
              <div className="flex flex-wrap items-start justify-between gap-4 bg-burgundy px-5 py-4 text-white">
                <div>
                  <p className="text-xs uppercase tracking-wide text-white/70">Handover Certificate</p>
                  <h2 className="doc-id text-xl font-semibold">{cert.certificate_number}</h2>
                </div>
                <div className="flex items-center gap-2">
                  {cert.superseded_at && <Badge tone="neutral">Superseded</Badge>}
                  {cert.rejected_at && <Badge tone="danger">Rejected</Badge>}
                  {cert.is_conditional && <Badge tone="warning">Conditional</Badge>}
                  {!cert.rejected_at && (
                    <Badge tone={cert.acknowledged_at ? "success" : "warning"}>
                      {cert.acknowledged_at ? "Acknowledged" : "Awaiting acknowledgment"}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="px-5 py-4">
                <p className="text-base font-medium text-ink">
                  {cert.data_books?.book_number} — {cert.data_books?.title}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {cert.data_books?.projects?.organizations?.name} · {cert.data_books?.projects?.name} (
                  {cert.data_books?.projects?.project_number}) · Issued {formatUtcDate(cert.issued_date)}
                  {session.isJagsStaff && projectId && (
                    <>
                      {" · "}
                      <Link href={`/inspect/projects/${projectId}/data-book`} className="text-burgundy hover:underline">
                        Open Data Book
                      </Link>
                    </>
                  )}
                </p>
                {cert.notes && <p className="mt-1 whitespace-pre-line text-xs text-muted">{cert.notes}</p>}
                {cert.is_conditional && (
                  <div className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-ink">
                    <p className="font-medium">
                      Conditional Handover — issued with open items outstanding.
                    </p>
                    {cert.conditional_reason && <p className="mt-1 text-xs">{cert.conditional_reason}</p>}
                    {openItems.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-xs">
                        {openItems.slice(0, OPEN_ITEMS_SHOWN).map((item) => (
                          <li key={item.id}>
                            • {item.description}
                            {item.location ? ` (${formatLocationForDisplay(item.location)})` : ""} — {item.responsible_party_name ?? "unassigned"},
                            agreed due {item.due_date ? formatUtcDate(item.due_date) : "no date set"}
                          </li>
                        ))}
                        {openItems.length > OPEN_ITEMS_SHOWN && (
                          <li className="text-muted">… and {openItems.length - OPEN_ITEMS_SHOWN} more open items (listed in the certificate PDF).</li>
                        )}
                      </ul>
                    )}
                  </div>
                )}
                <div className="mt-2 text-sm">
                  {pdfInfo?.url ? (
                    <span className="inline-flex flex-wrap items-center gap-3">
                      <a href={pdfInfo.url} target="_blank" rel="noreferrer" className="font-medium text-burgundy hover:underline">
                        Handover certificate (PDF) →
                      </a>
                      {pdfInfo.createdAt && <span className="text-xs text-muted">as of {formatUtcDateTime(pdfInfo.createdAt)}</span>}
                      {pdfStale && <span className="text-xs font-medium text-warning">predates the acknowledgement{pdfInfo.inFlight ? " — updating…" : ""}</span>}
                      {session.isJagsStaff && !pdfInfo.inFlight && <CertificatePdfButton dataBookId={cert.data_book_id} label="Regenerate" />}
                    </span>
                  ) : pdfInfo?.inFlight ? (
                    <span className="text-muted">Handover certificate PDF is being prepared…</span>
                  ) : session.isJagsStaff ? (
                    <CertificatePdfButton dataBookId={cert.data_book_id} />
                  ) : null}
                </div>
                {packageLinks.has(cert.id) ? (
                  <>
                    <p className="mt-2 text-sm">
                      <a href={packageLinks.get(cert.id)} className="font-medium text-burgundy hover:underline">
                        Download handover package →
                      </a>
                    </p>
                    {cert.package_sha256 && (
                      <p className="mt-1 break-all font-mono text-xs text-muted" title="SHA-256 fingerprint of the exact certified file — compare this to any copy you receive elsewhere to verify it's unmodified.">
                        SHA-256: {cert.package_sha256}
                      </p>
                    )}
                    {cert.rendered_book_sha256 && (
                      <p className="mt-1 break-all font-mono text-xs text-muted" title="SHA-256 of the Data Book PDF rendered at issue time.">
                        Data Book PDF SHA-256: {cert.rendered_book_sha256}
                      </p>
                    )}
                    {cert.verification_token && (
                      <p className="mt-1 text-xs text-muted">
                        Anyone can confirm this certificate is genuine at{" "}
                        <Link href={`/verify/certificate/${cert.verification_token}`} className="text-burgundy hover:underline" target="_blank">
                          its verification page
                        </Link>{" "}
                        (the QR code on the certificate PDF opens the same page).
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
                  <div className="text-sm text-success">
                    <p>
                      Acknowledged by {cert.received_by_name ?? "—"}
                      {cert.received_by_company ? `, ${cert.received_by_company}` : ""} on {formatUtcDateTime(cert.acknowledged_at)}
                      {cert.acknowledged_by && ackNames.get(cert.acknowledged_by)
                        ? ` · recorded by ${ackNames.get(cert.acknowledged_by)}${cert.acknowledged_on_behalf ? " (JAGS staff, on behalf of the client)" : ""}`
                        : cert.acknowledged_on_behalf
                          ? " · recorded by JAGS staff on behalf of the client"
                          : ""}
                    </p>
                    {cert.ack_comment && <p className="mt-1 text-xs text-ink">Comment: {cert.ack_comment}</p>}
                    {(cert.ack_has_signature || cert.ack_evidence_path) && (
                      <p className="mt-1 text-xs text-ink">
                        {cert.ack_has_signature ? "Signed on the signature pad (shown on the certificate PDF)." : ""}
                        {cert.ack_has_signature && cert.ack_evidence_path ? " " : ""}
                        {cert.ack_evidence_path &&
                          (pathToUrl.get(cert.ack_evidence_path) ? (
                            <>
                              Supporting file:{" "}
                              <a href={pathToUrl.get(cert.ack_evidence_path)} className="text-burgundy hover:underline" target="_blank" rel="noopener noreferrer">
                                {cert.ack_evidence_name ?? "download"}
                              </a>
                            </>
                          ) : (
                            <>Supporting file attached{cert.ack_evidence_name ? `: ${cert.ack_evidence_name}` : ""}.</>
                          ))}
                      </p>
                    )}
                  </div>
                ) : cert.rejected_at ? (
                  <div className="w-full text-sm">
                    <p className="font-medium text-danger">Rejected by the client on {formatUtcDateTime(cert.rejected_at)}.</p>
                    {cert.rejection_reason && <p className="mt-1 whitespace-pre-line text-xs text-ink">Reason: {cert.rejection_reason}</p>}
                    <p className="mt-1 text-xs text-muted">JAGS will correct the package and issue a new revision, which supersedes this certificate.</p>
                    {onBehalfAllowed && !cert.superseded_at && (
                      <div className="mt-2">
                        <ReopenRejectionForm certificateId={cert.id} />
                      </div>
                    )}
                  </div>
                ) : !packageLinks.has(cert.id) ? (
                  <p className="text-sm text-muted">Acknowledgement is unavailable until a package file is attached to this certificate.</p>
                ) : cert.superseded_at ? (
                  <p className="text-sm text-muted">This certificate was superseded by a later revision.</p>
                ) : isClient || onBehalfAllowed ? (
                  <div className="flex w-full flex-wrap items-start gap-2">
                    <AcknowledgeForm
                      certificateId={cert.id}
                      dataBookId={cert.data_book_id}
                      certificateNumber={cert.certificate_number}
                      onBehalf={!isClient && onBehalfAllowed}
                      userName={session.fullName}
                      signatureEnabled={signatureEnabled}
                    />
                    {isClient && <RejectForm certificateId={cert.id} certificateNumber={cert.certificate_number} />}
                  </div>
                ) : (
                  <p className="text-sm text-muted">Awaiting client acknowledgement.</p>
                )}
              </div>
            </div>
          );
        })}

        {certificatesShown.length === 0 && (
          <p className="text-sm text-muted">{q || statusFilter !== "all" ? "No certificates match these filters." : "No handover packages have been issued yet."}</p>
        )}
      </div>

      {pageCount > 1 && (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pagination">
          {page > 1 ? (
            <Link href={baseParams({ page: String(page - 1) })} className="text-burgundy hover:underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {page} of {pageCount} · {total} certificates
          </span>
          {page < pageCount ? (
            <Link href={baseParams({ page: String(page + 1) })} className="text-burgundy hover:underline">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
