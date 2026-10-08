import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom } from "@/lib/supabase/untyped";
import { isMissingDbObject, formatUtcDate, formatUtcDateTime } from "@/lib/databook/db-errors";
import { OrgPickerForm } from "../numbering/org-picker-form";
import { PageGuide } from "@/components/domain/page-guide";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import {
  REVIEW_OUTCOME_LABEL,
  RETENTION_FLAGS_TABLE,
  RETENTION_SETTINGS_TABLE,
  daysPastDue,
  type RetentionFlagRow,
} from "@/lib/retention/logic";
import { RetentionSettingsForm, ReviewFlagForm } from "./retention-forms";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

const DEFAULT_YEARS = 7;
const SHOWN = 100;

/**
 * Document retention (S6-18): an organisation-level retention period and the list of documents the
 * worker has flagged as past it. Admin-only. Flagging never deletes or changes a document: an Admin
 * records a decision (keep / disposal approved) and that decision is the audit record.
 */
export async function RetentionSettingsView({ searchParams, embedded }: { searchParams: { org?: string }; embedded?: boolean }) {
  const tl = await getTranslator();
  const Heading = embedded ? "h2" : "h1";
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const supabase = await createSupabaseServerClient();
  const { data: organizations } = await supabase.from("organizations").select("id, name").order("name").returns<{ id: string; name: string }[]>();
  const selectedOrg = organizations?.find((o) => o.id === searchParams.org) ?? organizations?.[0] ?? null;

  let setting: { retention_years: number; enabled: boolean } | null = null;
  let flags: RetentionFlagRow[] = [];
  let unavailable = false;
  if (selectedOrg) {
    const { data, error } = await untypedFrom(supabase, RETENTION_SETTINGS_TABLE)
      .select("retention_years, enabled")
      .eq("organization_id", selectedOrg.id)
      .maybeSingle<{ retention_years: number; enabled: boolean }>();
    if (error && isMissingDbObject(error)) unavailable = true;
    setting = data ?? null;

    if (!unavailable) {
      const { data: flagRows } = await untypedFrom(supabase, RETENTION_FLAGS_TABLE)
        .select(
          "document_id, organization_id, project_id, retention_years, reference_date, due_on, flagged_at, review_outcome, review_note, reviewed_at, vault_documents(title, document_number, revision, status), users:reviewed_by(full_name)"
        )
        .eq("organization_id", selectedOrg.id)
        .order("reviewed_at", { ascending: true, nullsFirst: true })
        .order("due_on", { ascending: true })
        .limit(SHOWN)
        .returns<RetentionFlagRow[]>();
      flags = flagRows ?? [];
    }
  }
  const awaiting = flags.filter((f) => !f.review_outcome);
  // Server component: evaluated once per request, which is the intended "now".
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Heading className="text-2xl font-semibold text-ink"><T>Document retention</T></Heading>
        <PageGuide
          title={tl("Document retention — how this works")}
          points={[
            "Set how many years this organisation's vault documents must be kept. Once a day a background sweep flags every document that is past that period.",
            "The clock starts when a document was approved, or uploaded if it was never approved.",
            "Flagging is only a review list: nothing is ever deleted, hidden or changed automatically. An Admin decides to keep a document or to approve its disposal, with a note; that decision is recorded in the audit log.",
            "Approving disposal does not remove the file. If a document must really be destroyed, that is done outside this system under your records policy.",
            "Admins of the organisation are notified when new documents are flagged.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted"><T>Flag vault documents that have outlived their retention period so a person can decide what happens to them.</T></p>

      <OrgPickerForm organizations={organizations ?? []} selectedOrgId={selectedOrg?.id ?? null} />

      {unavailable && (
        <p className="mt-6 rounded-md bg-warning/10 px-3 py-2 text-sm text-ink">
          <T>Retention rules need the latest database update (migration 20261112000103). Ask a JAGS Admin to apply it.</T>
        </p>
      )}

      {selectedOrg && !unavailable && (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Retention period" value={setting?.enabled ? `${setting.retention_years} years` : "Off"} />
            <StatCard label="Awaiting review" value={String(awaiting.length)} />
            <StatCard label="Reviewed" value={String(flags.length - awaiting.length)} />
          </div>

          <div className="mt-6">
            <RetentionSettingsForm
              key={`${selectedOrg.id}-${setting?.retention_years ?? "new"}-${setting?.enabled ?? "off"}`}
              organizationId={selectedOrg.id}
              retentionYears={setting?.retention_years ?? DEFAULT_YEARS}
              enabled={setting?.enabled ?? false}
            />
          </div>

          <section className="mt-8" aria-label={tl("Flagged documents")}>
            <h3 className="text-sm font-semibold text-ink"><T>Documents past retention</T></h3>
            {flags.length === 0 ? (
              <p className="mt-1 text-sm text-muted"><T>No documents have been flagged for this organisation.</T></p>
            ) : (
              <ul className="mt-2 divide-y divide-border rounded-md border border-border text-sm">
                {flags.map((f) => (
                  <li key={f.document_id} className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/inspect/vault/${f.project_id}/document/${f.document_id}`} className="font-medium text-burgundy hover:underline">
                        {f.vault_documents?.document_number ? `${f.vault_documents.document_number} — ` : ""}
                        {f.vault_documents?.title ?? "Document"}
                        {f.vault_documents ? ` (Rev ${f.vault_documents.revision})` : ""}
                      </Link>
                      {f.review_outcome ? (
                        <Badge showIcon tone={f.review_outcome === "keep" ? "success" : "warning"}>
                          {REVIEW_OUTCOME_LABEL[f.review_outcome]}
                        </Badge>
                      ) : (
                        <Badge showIcon tone="warning"><T>Needs review</T></Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      <T>Retention of</T> {f.retention_years} <T>years ended</T> {formatUtcDate(f.due_on)} ({daysPastDue(f.due_on, now)} <T>days ago) · flagged</T> {formatUtcDateTime(f.flagged_at)}
                    </p>
                    {f.review_outcome ? (
                      <p className="mt-1 text-xs text-ink">
                        {f.users?.full_name ? `${f.users.full_name}: ` : ""}
                        {REVIEW_OUTCOME_LABEL[f.review_outcome]} <T>on</T> {formatUtcDateTime(f.reviewed_at)}
                        {f.review_note ? ` — ${f.review_note}` : ""}
                      </p>
                    ) : (
                      <ReviewFlagForm documentId={f.document_id} />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {flags.length >= SHOWN && <p className="mt-2 text-xs text-muted"><T>Showing the first</T> {SHOWN}.</p>}
          </section>
        </>
      )}
    </div>
  );
}
