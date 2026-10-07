import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { formatUtcDate } from "@/lib/databook/db-errors";

// Public verification page for QR codes printed on handover certificates and IRNs. No login: it
// calls the verify_document() SECURITY DEFINER function with the unguessable token and shows ONLY
// the number, status, date and hash - never project, organisation, party or user data.
export const metadata: Metadata = {
  title: "Document verification",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

interface VerifyResult {
  valid: boolean;
  kind?: string;
  number?: string;
  status?: string;
  issued_date?: string | null;
  conditional?: boolean;
  package_sha256?: string | null;
  data_book_sha256?: string | null;
  voided_at?: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  issued: "Issued — awaiting acknowledgement",
  acknowledged: "Issued and acknowledged by the client",
  superseded: "Superseded by a later revision",
  live: "Live — valid for release",
  void: "VOID — this release has been withdrawn",
};

async function verify(kind: string, token: string): Promise<{ result: VerifyResult | null; unavailable: boolean }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { result: null, unavailable: true };
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("verify_document" as never, { p_kind: kind, p_token: token } as never);
  if (error) return { result: null, unavailable: true };
  return { result: data as unknown as VerifyResult, unavailable: false };
}

export default async function VerifyPage({ params }: { params: Promise<{ kind: string; token: string }> }) {
  const { kind, token } = await params;
  const safeKind = kind === "certificate" || kind === "irn" ? kind : "";
  const { result, unavailable } = safeKind ? await verify(safeKind, token) : { result: { valid: false } as VerifyResult, unavailable: false };

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold text-ink">Document verification</h1>
      {unavailable ? (
        <p className="mt-4 rounded-md bg-warning/10 px-3 py-2 text-sm text-ink">Verification is not available right now. Try again later.</p>
      ) : result?.valid ? (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <p className={`text-sm font-semibold ${result.status === "void" || result.status === "superseded" ? "text-danger" : "text-success"}`}>
            {result.status === "void" ? "This document is VOID" : result.status === "superseded" ? "This document has been superseded" : "This document is genuine"}
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">{result.kind === "irn" ? "Inspection Release Note" : "Handover certificate"}</dt>
              <dd className="doc-id font-medium text-ink">{result.number}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Status</dt>
              <dd className="text-ink">{STATUS_TEXT[result.status ?? ""] ?? result.status}</dd>
            </div>
            {result.issued_date && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Date</dt>
                <dd className="text-ink">{formatUtcDate(result.issued_date)}</dd>
              </div>
            )}
            {result.conditional && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Type</dt>
                <dd className="text-ink">Conditional handover (open items outstanding)</dd>
              </div>
            )}
            {result.package_sha256 && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Package SHA-256</dt>
                <dd className="break-all font-mono text-xs text-ink">{result.package_sha256}</dd>
              </div>
            )}
            {result.data_book_sha256 && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Data Book PDF SHA-256</dt>
                <dd className="break-all font-mono text-xs text-ink">{result.data_book_sha256}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-muted">Compare the fingerprint with your copy of the file to confirm it is unmodified. Project details are only available to authorised users.</p>
        </div>
      ) : (
        <p className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">No document matches this code. Do not rely on a document that cannot be verified.</p>
      )}
    </main>
  );
}
