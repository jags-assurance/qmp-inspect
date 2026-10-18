import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { PrintButton } from "@/app/inspect/itps/print/print-button";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AUDIT_LOG_TABLE, type AuditLogRow } from "@/lib/audit/types";
import { ITP_REVISIONS_TABLE } from "@/lib/itps/revision-types";
import { PageGuide } from "@/components/domain/page-guide";
import { computeCalibrationStatus, computeWelderStatus, daysUntil, describeDays } from "@/lib/registers/status";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { fetchRegisterUsage } from "@/lib/registers/usage";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";
import { Button } from "@/components/ui/button";
import { ResponsiveTable } from "@/components/ui/responsive-table";

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface UserRef {
  full_name: string;
  email: string;
}

interface AuditEventRow extends Pick<AuditLogRow, "id" | "action" | "summary" | "created_at"> {
  actor: UserRef | null;
}

interface ItpMatch {
  id: string;
  itp_number: string;
  title: string;
  status: string;
  revision: number;
  phase: string;
  scope: string | null;
  applicable_standard: string | null;
  external_approval_reference: string | null;
  created_at: string;
  project: { id: string; project_number: string; name: string; organizations: { name: string } | null } | null;
  prepared_by_user: UserRef | null;
  approved_by_user: UserRef | null;
  reviewed_by_user: UserRef | null;
}

interface NcrMatch {
  id: string;
  ncr_number: string;
  description: string;
  severity: string;
  status: string;
  due_date: string | null;
  closed_at: string | null;
  created_at: string;
  itp_item_id: string | null;
  inspection_record_id: string | null;
  project: { id: string; project_number: string; name: string; organizations: { name: string } | null } | null;
  raised_by_user: UserRef | null;
  assigned_to_user: UserRef | null;
  closed_by_user: UserRef | null;
}

interface InspectionRecordMatch {
  id: string;
  record_number: string;
  itp_number: string;
  itp_item_id: string;
  activity: string;
  overall_result: string | null;
  inspection_date: string;
  location: string | null;
  client_name: string | null;
  applicable_standard: string | null;
  governing_drawing_reference: string | null;
  governing_drawing_revision: string | null;
  project_name: string;
  project: { id: string; project_number: string; name: string; organizations: { name: string } | null } | null;
  inspector: UserRef | null;
}

interface RevisionRow {
  id: string;
  revision: number;
  title: string;
  reason: string | null;
  created_at: string;
  created_by_user: UserRef | null;
}

interface LinkedItpRow {
  id: string;
  itp_number: string;
  title: string;
  status: string;
}

interface LinkedNcrRow {
  id: string;
  ncr_number: string;
  description: string;
  status: string;
  severity: string;
}

interface LinkedInspectionRow {
  id: string;
  record_number: string;
  activity: string;
  overall_result: string | null;
  inspection_date: string;
}

/**
 * R105: given ANY document number in the system, find which record it belongs to and show its full
 * lineage in one place — the "no dedicated lineage page exists anywhere" audit finding. This is a
 * read-only aggregation over data that already exists elsewhere (numbering, itp_revisions/R101,
 * audit_log/R102, and the real foreign keys below); it writes nothing and invents no relationship.
 *
 * What IS genuinely traceable, per the real schema (packages/shared-types/src/database.ts):
 *   - itps <-> itp_sections <-> itp_items: an ITP's items, reached through its sections (itp_items
 *     has no direct itp_id column).
 *   - inspection_records.itp_item_id -> itp_items.id (real FK): an inspection record always names
 *     the specific ITP item it was recorded against, so it's traceable back to its ITP via
 *     itp_items -> itp_sections -> itps.
 *   - ncrs.itp_item_id -> itp_items.id (real FK, nullable) and ncrs.inspection_record_id ->
 *     inspection_records.id (real FK, nullable): an NCR MAY reference the ITP item and/or the
 *     inspection record it was raised against, but both are optional — an NCR raised without going
 *     through a specific checklist item/record legitimately has neither set.
 *   - itp_revisions.itp_id -> itps.id (R101) and audit_log.entity_id (R102, entity_type
 *     'itp'/'ncr'/'inspection_record') give the revision history and the who/what/when trail.
 *
 * What is honestly NOT a real link (and is not fabricated here): NCRs and inspection records do not
 * carry a project-wide "governing drawing" chain beyond the single itp_items.governing_drawing_
 * document_id column, and there's no join from an inspection_record or NCR to itp_master_templates
 * (the master library is a separate, unlinked authoring source copied into itps at creation time).
 */
export default async function DocumentTraceabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; project?: string }>;
}) {
  return <DocumentTraceabilityView searchParams={await searchParams} />;
}

/** The traceability lookup; `embedded` renders it as a section of the Settings hub. */
export async function DocumentTraceabilityView({
  searchParams,
  embedded,
}: {
  searchParams: { q?: string; project?: string };
  embedded?: boolean;
}) {
  const tl = await getTranslator();
  const session = await requireSession();
  if (!session.isJagsStaff) redirect("/inspect?denied=1"); // JAGS staff; row-level security limits what each person can see to their own projects

  const { q, project: projectParam } = searchParams;
  const query = q?.trim() ?? "";
  const supabase = await createSupabaseServerClient();
  // Optional scope: the same document number can exist on several projects, so a lookup can be limited to one.
  const { data: scopeProjects } = await supabase.from("projects").select("id, project_number, name").order("name").returns<{ id: string; project_number: string; name: string }[]>();
  const scopeProject = (scopeProjects ?? []).find((p) => p.id === projectParam) ?? null;
  const projectId = scopeProject?.id ?? null;

  let itp: ItpMatch | null = null;
  let ncr: NcrMatch | null = null;
  let record: InspectionRecordMatch | null = null;
  let notFoundMessage: string | null = null;
  let registerHits: RegisterHit[] = [];

  if (query) {
    registerHits = await findRegisterEntries(supabase, query);
    if (projectId) registerHits = registerHits.filter((h) => h.project?.id === projectId);
    itp = await findItp(supabase, query, projectId);
    if (!itp) ncr = await findNcr(supabase, query, projectId);
    if (!itp && !ncr) record = await findInspectionRecord(supabase, query, projectId);
    if (!itp && !ncr && !record && registerHits.length === 0) {
      notFoundMessage = `No ITP, NCR, inspection record or register entry (heat/batch/PO/certificate/instrument/welder) found for "${query}"${scopeProject ? ` on ${scopeProject.name}` : ""}.`;
    }
  }

  return (
    <div>
      <SettingsBackLink embedded={embedded} href="/inspect/settings?section=insights" />
      <PageHeader
        className="mt-2"
        titleAs={embedded ? "h2" : "h1"}
        title={<T>Document Traceability</T>}
        guide={
        <PageGuide
          title={tl("Document Traceability — how this works")}
          points={[
            "JAGS-staff, read-only lookup (you only see projects you have access to) — enter any ITP, NCR or inspection report number and see its full lineage: identity, revision history, related records and audit trail. It writes nothing.",
            "An ITP's items are reached through its sections (itp_items has no direct itp_id column) — that's how related inspection records and NCRs for an ITP get found.",
            "An NCR's link to a specific ITP item and/or inspection record is optional — an NCR raised without going through a specific checklist item legitimately shows neither.",
            "This aggregates real foreign keys that already exist elsewhere (numbering, ITP revisions, the audit log) — it does not fabricate any relationship the schema doesn't actually have, e.g. there's no link from a record to the master template library it was originally copied from.",
          ]}
        />
        }
      />
      <p className="mt-1 text-sm text-muted">
        <T>Look up any ITP, NCR or inspection number.</T>
      </p>

      <form className="mt-6 flex max-w-3xl flex-wrap gap-2 print:hidden">
        {embedded && <input type="hidden" name="section" value="traceability" />}
        <input aria-label={tl("ITP / NCR / IRN number, heat / batch / PO / cert number, instrument ID, welder ID / WPQ")}
          type="text"
          name="q"
          defaultValue={query}
          placeholder={tl("ITP / NCR / IRN number, heat / batch / PO / cert number, instrument ID, welder ID / WPQ")}
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        <Button
          type="submit"
          
        >
          <T>Look up</T>
        </Button>
        <select
          name="project"
          defaultValue={projectId ?? ""}
          aria-label={tl("Limit the lookup to one project")}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value=""><T>All my projects</T></option>
          {(scopeProjects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_number} - {p.name}
            </option>
          ))}
        </select>
        {(itp || ncr || record || registerHits.length > 0) && <PrintButton />}
      </form>
      {scopeProject && (
        <p className="mt-2 text-xs text-muted">
          <T>Showing results for</T> {scopeProject.project_number} - {scopeProject.name} <T>only.</T>
        </p>
      )}

      {notFoundMessage && (
        <p className="mt-6 rounded-md border border-border bg-surface p-4 text-sm text-muted">{notFoundMessage}</p>
      )}

      {registerHits.length > 0 && <RegisterHits supabase={supabase} hits={registerHits} />}
      {itp && <ItpLineage supabase={supabase} itp={itp} />}
      {ncr && <NcrLineage supabase={supabase} ncr={ncr} />}
      {record && <InspectionRecordLineage supabase={supabase} record={record} />}
    </div>
  );
}

async function findItp(supabase: SupabaseClient, itpNumber: string, projectId: string | null): Promise<ItpMatch | null> {
  let query = supabase
    .from("itps")
    .select(
      `id, itp_number, title, status, revision, phase, scope, applicable_standard, external_approval_reference,
       created_at,
       project:projects(id, project_number, name, organizations(name)),
       prepared_by_user:users!itps_prepared_by_fkey(full_name, email),
       approved_by_user:users!itps_approved_by_fkey(full_name, email),
       reviewed_by_user:users!itps_reviewed_by_fkey(full_name, email)`
    )
    .eq("itp_number", itpNumber);
  if (projectId) query = query.eq("project_id", projectId);
  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle<ItpMatch>();
  return data ?? null;
}

async function findNcr(supabase: SupabaseClient, ncrNumber: string, projectId: string | null): Promise<NcrMatch | null> {
  let query = supabase
    .from("ncrs")
    .select(
      `id, ncr_number, description, severity, status, due_date, closed_at, created_at,
       itp_item_id, inspection_record_id,
       project:projects(id, project_number, name, organizations(name)),
       raised_by_user:users!ncrs_raised_by_fkey(full_name, email),
       assigned_to_user:users!ncrs_assigned_to_fkey(full_name, email),
       closed_by_user:users!ncrs_closed_by_fkey(full_name, email)`
    )
    .eq("ncr_number", ncrNumber);
  if (projectId) query = query.eq("project_id", projectId);
  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle<NcrMatch>();
  return data ?? null;
}

async function findInspectionRecord(supabase: SupabaseClient, recordNumber: string, projectId: string | null): Promise<InspectionRecordMatch | null> {
  let query = supabase
    .from("inspection_records")
    .select(
      `id, record_number, itp_number, itp_item_id, activity, overall_result, inspection_date, location,
       client_name, applicable_standard, governing_drawing_reference, governing_drawing_revision, project_name,
       project:projects(id, project_number, name, organizations(name)),
       inspector:users!inspection_records_inspector_id_fkey(full_name, email)`
    )
    .eq("record_number", recordNumber);
  if (projectId) query = query.eq("project_id", projectId);
  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle<InspectionRecordMatch>();
  return data ?? null;
}

/** itp_items has no direct itp_id column — it only reaches an ITP through itp_sections.itp_id. */
async function itpIdForItpItem(supabase: SupabaseClient, itpItemId: string): Promise<string | null> {
  const { data } = await supabase
    .from("itp_items")
    .select("section_id, itp_sections(itp_id)")
    .eq("id", itpItemId)
    .maybeSingle<{ section_id: string; itp_sections: { itp_id: string } | null }>();
  return data?.itp_sections?.itp_id ?? null;
}

async function itemIdsForItp(supabase: SupabaseClient, itpId: string): Promise<string[]> {
  const { data: sections } = await supabase.from("itp_sections").select("id").eq("itp_id", itpId).returns<{ id: string }[]>();
  const sectionIds = (sections ?? []).map((s) => s.id);
  if (sectionIds.length === 0) return [];
  const { data: items } = await supabase
    .from("itp_items")
    .select("id")
    .in("section_id", sectionIds)
    .returns<{ id: string }[]>();
  return (items ?? []).map((i) => i.id);
}

async function fetchRevisions(supabase: SupabaseClient, itpId: string): Promise<RevisionRow[]> {
  const { data } = await supabase
    .from(ITP_REVISIONS_TABLE)
    .select("id, revision, title, reason, created_at, created_by_user:users(full_name, email)")
    .eq("itp_id", itpId)
    .order("revision", { ascending: false })
    .returns<RevisionRow[]>();
  return data ?? [];
}

async function fetchAuditTrail(supabase: SupabaseClient, entityType: string, entityId: string): Promise<AuditEventRow[]> {
  const { data } = await supabase
    .from(AUDIT_LOG_TABLE)
    .select("id, action, summary, created_at, actor:users(full_name, email)")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .returns<AuditEventRow[]>();
  return data ?? [];
}

function IdentityRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1.5 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-end text-ink">{value ?? "—"}</span>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function AuditTrailTable({ events }: { events: AuditEventRow[] }) {
  if (events.length === 0) return <p className="text-sm text-muted"><T>No audit events recorded for this document.</T></p>;
  return (
    <ResponsiveTable
      breakpoint="md"
      caption="Audit trail"
      rows={events}
      rowKey={(event) => event.id}
      headRowClassName="border-b border-border text-start text-xs uppercase text-muted"
      thClassName="py-2 pe-3"
      tdClassName="py-2 pe-3 align-top"
      columns={[
        { key: "ts", header: "Timestamp", className: "whitespace-nowrap text-xs text-muted", render: (event) => new Date(event.created_at).toLocaleString("en-GB") },
        {
          key: "actor",
          header: "Actor",
          render: (event) =>
            event.actor ? (
              <span>
                {event.actor.full_name}
                <span className="ms-1 break-all text-xs text-muted">({event.actor.email})</span>
              </span>
            ) : (
              <span className="text-xs text-muted"><T>System</T></span>
            ),
        },
        { key: "action", header: "Action", className: "text-xs text-muted", render: (event) => event.action },
        { key: "summary", header: "Summary", cardLabel: null, className: "text-ink", render: (event) => event.summary },
      ]}
    />
  );
}

async function ItpLineage({ supabase, itp }: { supabase: SupabaseClient; itp: ItpMatch }) {
  const tl = await getTranslator();
  const [revisions, auditEvents, itemIds] = await Promise.all([
    fetchRevisions(supabase, itp.id),
    fetchAuditTrail(supabase, "itp", itp.id),
    itemIdsForItp(supabase, itp.id),
  ]);

  let relatedInspections: LinkedInspectionRow[] = [];
  let relatedNcrs: LinkedNcrRow[] = [];
  if (itemIds.length > 0) {
    const [{ data: inspections }, { data: ncrs }] = await Promise.all([
      supabase
        .from("inspection_records")
        .select("id, record_number, activity, overall_result, inspection_date")
        .in("itp_item_id", itemIds)
        .order("inspection_date", { ascending: false })
        .returns<LinkedInspectionRow[]>(),
      supabase
        .from("ncrs")
        .select("id, ncr_number, description, status, severity")
        .in("itp_item_id", itemIds)
        .order("created_at", { ascending: false })
        .returns<LinkedNcrRow[]>(),
    ]);
    relatedInspections = inspections ?? [];
    relatedNcrs = ncrs ?? [];
  }

  return (
    <>
      <SectionCard title={`ITP — ${itp.itp_number}`}>
        <IdentityRow label="Title" value={itp.title} />
        <IdentityRow
          label="Project"
          value={
            itp.project ? (
              <Link href={`/inspect/projects/${itp.project.id}`} className="text-burgundy hover:underline">
                {itp.project.organizations?.name ?? "—"} · {itp.project.project_number} {itp.project.name}
              </Link>
            ) : null
          }
        />
        <IdentityRow label="Status" value={itp.status} />
        <IdentityRow label="Current revision" value={itp.revision} />
        <IdentityRow label="Phase" value={itp.phase} />
        <IdentityRow label="Scope" value={itp.scope} />
        <IdentityRow label="Applicable standard" value={itp.applicable_standard} />
        <IdentityRow label="External approval reference" value={itp.external_approval_reference} />
        <IdentityRow label="Prepared by" value={itp.prepared_by_user?.full_name} />
        <IdentityRow label="Reviewed by" value={itp.reviewed_by_user?.full_name} />
        <IdentityRow label="Approved by" value={itp.approved_by_user?.full_name} />
        <p className="mt-3">
          <Link href={`/inspect/itps/${itp.id}`} className="text-sm text-burgundy hover:underline">
            <T>Open full ITP →</T>
          </Link>
        </p>
      </SectionCard>

      <SectionCard title={tl("Revision history (R101)")}>
        {revisions.length === 0 ? (
          <p className="text-sm text-muted"><T>No frozen revision snapshots yet — the ITP has not been issued.</T></p>
        ) : (
          <ul className="space-y-2 text-sm">
            {revisions.map((r) => (
              <li key={r.id} className="border-b border-border pb-2 last:border-0">
                <span className="font-medium text-ink"><T>Rev</T> {r.revision}</span> — {r.title}
                <div className="text-xs text-muted">
                  {r.reason ?? "No reason recorded"} · {new Date(r.created_at).toLocaleString("en-GB")}
                  {r.created_by_user ? ` · ${r.created_by_user.full_name}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={`Related inspection records (${relatedInspections.length})`}>
        {relatedInspections.length === 0 ? (
          <p className="text-sm text-muted"><T>No inspection records reference an item on this ITP.</T></p>
        ) : (
          <ul className="space-y-1 text-sm">
            {relatedInspections.map((r) => (
              <li key={r.id}>
                <Link href={`/inspect/inspections/${r.id}`} className="text-burgundy hover:underline">
                  {r.record_number}
                </Link>{" "}
                — {r.activity} ({r.overall_result ?? "pending"}) · {new Date(r.inspection_date).toLocaleDateString("en-GB")}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={`Related NCRs (${relatedNcrs.length})`}>
        {relatedNcrs.length === 0 ? (
          <p className="text-sm text-muted"><T>No NCRs reference an item on this ITP.</T></p>
        ) : (
          <ul className="space-y-1 text-sm">
            {relatedNcrs.map((n) => (
              <li key={n.id}>
                <Link href={`/inspect/ncrs/${n.id}`} className="text-burgundy hover:underline">
                  {n.ncr_number}
                </Link>{" "}
                — {n.description} ({n.status}, {n.severity})
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={tl("Audit trail (R102)")}>
        <AuditTrailTable events={auditEvents} />
      </SectionCard>
    </>
  );
}

async function NcrLineage({ supabase, ncr }: { supabase: SupabaseClient; ncr: NcrMatch }) {
  const tl = await getTranslator();
  const auditEventsPromise = fetchAuditTrail(supabase, "ncr", ncr.id);

  let sourceItp: LinkedItpRow | null = null;
  if (ncr.itp_item_id) {
    const itpId = await itpIdForItpItem(supabase, ncr.itp_item_id);
    if (itpId) {
      const { data } = await supabase
        .from("itps")
        .select("id, itp_number, title, status")
        .eq("id", itpId)
        .maybeSingle<LinkedItpRow>();
      sourceItp = data ?? null;
    }
  }

  let sourceInspection: LinkedInspectionRow | null = null;
  if (ncr.inspection_record_id) {
    const { data } = await supabase
      .from("inspection_records")
      .select("id, record_number, activity, overall_result, inspection_date")
      .eq("id", ncr.inspection_record_id)
      .maybeSingle<LinkedInspectionRow>();
    sourceInspection = data ?? null;
  }

  const auditEvents = await auditEventsPromise;

  return (
    <>
      <SectionCard title={`NCR — ${ncr.ncr_number}`}>
        <IdentityRow label="Description" value={ncr.description} />
        <IdentityRow
          label="Project"
          value={
            ncr.project ? (
              <Link href={`/inspect/projects/${ncr.project.id}`} className="text-burgundy hover:underline">
                {ncr.project.organizations?.name ?? "—"} · {ncr.project.project_number} {ncr.project.name}
              </Link>
            ) : null
          }
        />
        <IdentityRow label="Status" value={ncr.status} />
        <IdentityRow label="Severity" value={ncr.severity} />
        <IdentityRow label="Raised by" value={ncr.raised_by_user?.full_name} />
        <IdentityRow label="Assigned to" value={ncr.assigned_to_user?.full_name} />
        <IdentityRow label="Due date" value={ncr.due_date ? new Date(ncr.due_date).toLocaleDateString("en-GB") : null} />
        <IdentityRow label="Closed by" value={ncr.closed_by_user?.full_name} />
        <IdentityRow label="Closed at" value={ncr.closed_at ? new Date(ncr.closed_at).toLocaleString("en-GB") : null} />
        <p className="mt-3">
          <Link href={`/inspect/ncrs/${ncr.id}`} className="text-sm text-burgundy hover:underline">
            <T>Open full NCR →</T>
          </Link>
        </p>
      </SectionCard>

      <SectionCard title={tl("Raised against")}>
        {!sourceItp && !sourceInspection && (
          <p className="text-sm text-muted">
            <T>This NCR was not raised against a specific ITP item or inspection record (both links are optional on the ncrs table).</T>
          </p>
        )}
        {sourceItp && (
          <p className="text-sm">
            <T>ITP:</T>{" "}
            <Link href={`/inspect/itps/${sourceItp.id}`} className="text-burgundy hover:underline">
              {sourceItp.itp_number}
            </Link>{" "}
            — {sourceItp.title} ({sourceItp.status})
          </p>
        )}
        {sourceInspection && (
          <p className="mt-2 text-sm">
            <T>Inspection record:</T>{" "}
            <Link href={`/inspect/inspections/${sourceInspection.id}`} className="text-burgundy hover:underline">
              {sourceInspection.record_number}
            </Link>{" "}
            — {sourceInspection.activity} ({sourceInspection.overall_result ?? "pending"})
          </p>
        )}
      </SectionCard>

      <SectionCard title={tl("Audit trail (R102)")}>
        <AuditTrailTable events={auditEvents} />
      </SectionCard>
    </>
  );
}

async function InspectionRecordLineage({ supabase, record }: { supabase: SupabaseClient; record: InspectionRecordMatch }) {
  const tl = await getTranslator();
  const [auditEvents, itpId] = await Promise.all([
    fetchAuditTrail(supabase, "inspection_record", record.id),
    itpIdForItpItem(supabase, record.itp_item_id),
  ]);

  let sourceItp: LinkedItpRow | null = null;
  if (itpId) {
    const { data } = await supabase
      .from("itps")
      .select("id, itp_number, title, status")
      .eq("id", itpId)
      .maybeSingle<LinkedItpRow>();
    sourceItp = data ?? null;
  }

  const { data: relatedNcrs } = await supabase
    .from("ncrs")
    .select("id, ncr_number, description, status, severity")
    .eq("inspection_record_id", record.id)
    .order("created_at", { ascending: false })
    .returns<LinkedNcrRow[]>();

  return (
    <>
      <SectionCard title={`Inspection Record — ${record.record_number}`}>
        <IdentityRow label="Activity" value={record.activity} />
        <IdentityRow
          label="Project"
          value={
            record.project ? (
              <Link href={`/inspect/projects/${record.project.id}`} className="text-burgundy hover:underline">
                {record.project.organizations?.name ?? "—"} · {record.project.project_number} {record.project.name}
              </Link>
            ) : (
              record.project_name
            )
          }
        />
        <IdentityRow label="Overall result" value={record.overall_result} />
        <IdentityRow label="Inspection date" value={new Date(record.inspection_date).toLocaleDateString("en-GB")} />
        <IdentityRow label="Field Engineer" value={record.inspector?.full_name} />
        <IdentityRow label="Client name (frozen at inspection)" value={record.client_name} />
        <IdentityRow label="Applicable standard (frozen at inspection)" value={record.applicable_standard} />
        <IdentityRow
          label="Governing drawing (frozen at inspection)"
          value={
            record.governing_drawing_reference
              ? `${record.governing_drawing_reference} rev ${record.governing_drawing_revision ?? "—"}`
              : null
          }
        />
        <p className="mt-3">
          <Link href={`/inspect/inspections/${record.id}`} className="text-sm text-burgundy hover:underline">
            <T>Open full inspection record →</T>
          </Link>
        </p>
      </SectionCard>

      <SectionCard title={tl("Governing ITP")}>
        {sourceItp ? (
          <p className="text-sm">
            <Link href={`/inspect/itps/${sourceItp.id}`} className="text-burgundy hover:underline">
              {sourceItp.itp_number}
            </Link>{" "}
            — {sourceItp.title} ({sourceItp.status}<T>). Frozen at inspection time as</T>{" "}
            <span className="doc-id">{record.itp_number}</span>.
          </p>
        ) : (
          <p className="text-sm text-muted">
            <T>The governing ITP item could not be resolved (frozen number was</T>{" "}
            <span className="doc-id">{record.itp_number}</span>).
          </p>
        )}
      </SectionCard>

      <SectionCard title={`Related NCRs (${(relatedNcrs ?? []).length})`}>
        {(relatedNcrs ?? []).length === 0 ? (
          <p className="text-sm text-muted"><T>No NCRs reference this inspection record.</T></p>
        ) : (
          <ul className="space-y-1 text-sm">
            {(relatedNcrs ?? []).map((n) => (
              <li key={n.id}>
                <Link href={`/inspect/ncrs/${n.id}`} className="text-burgundy hover:underline">
                  {n.ncr_number}
                </Link>{" "}
                — {n.description} ({n.status}, {n.severity})
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={tl("Audit trail (R102)")}>
        <AuditTrailTable events={auditEvents} />
      </SectionCard>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Register traceability (heat / batch / PO / certificate numbers, instruments, welders)
// ---------------------------------------------------------------------------------------------

type RegisterKind = "material" | "calibration" | "welder";
type ProjectRef = { id: string; project_number: string; name: string; organizations: { name: string } | null } | null;

interface RegisterHit {
  kind: RegisterKind;
  id: string;
  title: string;
  details: { label: string; value: string | null }[];
  statusLabel: string;
  statusTone: "ok" | "warn" | "bad";
  expiry: string | null; // YYYY-MM-DD
  calDate: string | null;
  project: ProjectRef;
}

interface UsageRow {
  id: string;
  result: string;
  inspection_record_id: string;
  checklist_item: { item_number: string; description: string } | null;
  record: {
    id: string;
    record_number: string;
    activity: string;
    overall_result: string | null;
    inspection_date: string;
  } | null;
}

/** Strip characters that would break a PostgREST .or() filter or act as ilike wildcards. */
function sanitizeTerm(term: string): string {
  return term.replace(/[,()%_*\\]/g, " ").trim();
}

async function findRegisterEntries(supabase: SupabaseClient, rawQuery: string): Promise<RegisterHit[]> {
  const term = sanitizeTerm(rawQuery);
  if (!term) return [];
  const like = `%${term}%`;
  const projectSel = "project:projects(id, project_number, name, organizations(name))";

  const [materials, calibrations, welders] = await Promise.all([
    supabase
      .from("material_register")
      .select(
        `id, material_description, heat_number, batch_number, po_reference, certificate_reference, supplier, receipt_status, approval_status, ${projectSel}`
      )
      .or(
        `heat_number.ilike.${like},batch_number.ilike.${like},po_reference.ilike.${like},certificate_reference.ilike.${like}`
      )
      .limit(25)
      .returns<
        {
          id: string;
          material_description: string;
          heat_number: string | null;
          batch_number: string | null;
          po_reference: string | null;
          certificate_reference: string | null;
          supplier: string | null;
          receipt_status: string | null;
          approval_status: string;
          project: ProjectRef;
        }[]
      >(),
    supabase
      .from("calibration_register")
      .select(`id, instrument_name, instrument_tag, calibration_lab, cert_number, cal_date, due_date, ${projectSel}`)
      .or(`instrument_name.ilike.${like},instrument_tag.ilike.${like},cert_number.ilike.${like}`)
      .limit(25)
      .returns<
        {
          id: string;
          instrument_name: string;
          instrument_tag: string | null;
          calibration_lab: string | null;
          cert_number: string;
          cal_date: string | null;
          due_date: string;
          project: ProjectRef;
        }[]
      >(),
    supabase
      .from("welder_qualification_register")
      .select(`id, welder_identifier, wpq_number, process, position, qualified_wps, expiry_date, ${projectSel}`)
      .or(`welder_identifier.ilike.${like},wpq_number.ilike.${like}`)
      .limit(25)
      .returns<
        {
          id: string;
          welder_identifier: string;
          wpq_number: string;
          process: string | null;
          position: string | null;
          qualified_wps: string | null;
          expiry_date: string;
          project: ProjectRef;
        }[]
      >(),
  ]);

  const hits: RegisterHit[] = [];
  for (const m of materials.data ?? []) {
    const tone = m.approval_status === "A" || m.approval_status === "B" ? "ok" : m.approval_status === "D" ? "bad" : "warn";
    hits.push({
      kind: "material",
      id: m.id,
      title: m.material_description,
      details: [
        { label: "Heat no.", value: m.heat_number },
        { label: "Batch no.", value: m.batch_number },
        { label: "PO", value: m.po_reference },
        { label: "Certificate", value: m.certificate_reference },
        { label: "Supplier", value: m.supplier },
        { label: "Receipt", value: m.receipt_status },
      ],
      statusLabel: `Approval ${m.approval_status}`,
      statusTone: tone,
      expiry: null,
      calDate: null,
      project: m.project,
    });
  }
  for (const c of calibrations.data ?? []) {
    const st = computeCalibrationStatus(c.due_date);
    hits.push({
      kind: "calibration",
      id: c.id,
      title: c.instrument_name,
      details: [
        { label: "Tag / ID", value: c.instrument_tag },
        { label: "Cert no.", value: c.cert_number },
        { label: "Lab", value: c.calibration_lab },
        { label: "Calibrated", value: c.cal_date },
      ],
      statusLabel: st === "expired" ? "Expired" : st === "due_soon" ? "Due soon" : "Valid",
      statusTone: st === "expired" ? "bad" : st === "due_soon" ? "warn" : "ok",
      expiry: c.due_date,
      calDate: c.cal_date,
      project: c.project,
    });
  }
  for (const w of welders.data ?? []) {
    const st = computeWelderStatus(w.expiry_date);
    hits.push({
      kind: "welder",
      id: w.id,
      title: `${w.welder_identifier} — WPQ ${w.wpq_number}`,
      details: [
        { label: "Process", value: w.process },
        { label: "Position", value: w.position },
        { label: "Qualified WPS", value: w.qualified_wps },
      ],
      statusLabel: st === "expired" ? "Expired" : st === "expiring" ? "Expiring" : "Valid",
      statusTone: st === "expired" ? "bad" : st === "expiring" ? "warn" : "ok",
      expiry: w.expiry_date,
      calDate: null,
      project: w.project,
    });
  }
  return hits;
}

const KIND_LABEL: Record<RegisterKind, string> = {
  material: "Material",
  calibration: "Calibration instrument",
  welder: "Welder qualification",
};

const TONE_CLASS: Record<RegisterHit["statusTone"], string> = {
  ok: "bg-success/10 text-success",
  warn: "bg-warning/10 text-warning",
  bad: "bg-danger/10 text-danger",
};

function fetchUsage(supabase: SupabaseClient, hit: RegisterHit) {
  return fetchRegisterUsage(supabase, { kind: hit.kind, id: hit.id, projectId: hit.project?.id ?? null });
}

async function RegisterHits({ supabase, hits }: { supabase: SupabaseClient; hits: RegisterHit[] }) {
  const usages = await Promise.all(hits.map((h) => fetchUsage(supabase, h)));
  return (
    <>
      {hits.map((hit, i) => (
        <RegisterHitCard key={`${hit.kind}-${hit.id}`} hit={hit} usage={usages[i].usage} cycleCount={usages[i].cycleCount} />
      ))}
    </>
  );
}

function RegisterHitCard({ hit, usage, cycleCount }: { hit: RegisterHit; usage: UsageRow[]; cycleCount: number }) {
  const inspectionIds = new Set(usage.map((u) => u.record?.id).filter(Boolean));
  // Rows linked into a recalibration chain are judged by the chain; a legacy row (its certificate was
  // overwritten in place before recalibration became a new row) falls back to "since the calibration date".
  const sinceCal = hit.kind === "calibration" && hit.calDate && cycleCount === 1 ? hit.calDate : null;
  const impacted = sinceCal
    ? usage.filter((u) => u.record && u.record.inspection_date.slice(0, 10) >= sinceCal)
    : usage;
  const impactedRecords = [...new Map(impacted.filter((u) => u.record).map((u) => [u.record!.id, u.record!])).values()];

  return (
    <SectionCard title={`${KIND_LABEL[hit.kind]} — ${hit.title}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[hit.statusTone]}`}>{hit.statusLabel}</span>
        {hit.expiry && (
          <span className="text-muted">
            {hit.kind === "calibration" ? "Due" : "Expires"} {new Date(hit.expiry).toLocaleDateString("en-GB")} (
            {describeDays(daysUntil(hit.expiry))})
          </span>
        )}
      </div>
      <div className="mt-2">
        <IdentityRow
          label="Project"
          value={
            hit.project ? (
              <Link href={`/inspect/projects/${hit.project.id}/registers`} className="text-burgundy hover:underline">
                {hit.project.organizations?.name ?? "—"} · {hit.project.project_number} {hit.project.name}
              </Link>
            ) : null
          }
        />
        {hit.details.map((d) => (
          <IdentityRow key={d.label} label={d.label} value={d.value} />
        ))}
      </div>

      {hit.kind === "calibration" && (
        <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <div className="font-semibold text-ink"><T>Impact report</T></div>
          <p className="mt-1 text-ink">
            <T>If this instrument is found out of tolerance, these</T> <span className="font-semibold">{impactedRecords.length}</span>{" "}
            <T>inspection</T>{impactedRecords.length === 1 ? "" : "s"} <T>used it</T>
            {sinceCal
              ? ` since ${new Date(sinceCal).toLocaleDateString("en-GB")} (last calibration)`
              : cycleCount > 1
                ? ` across ${cycleCount} calibration cycles (back to the last cycle recorded as in tolerance when it was recalibrated)`
                : " (all recorded uses are listed)"}
            .
          </p>
          <p className="mt-1 text-xs text-muted">
            <T>A recalibration is recorded as a new certificate linked to the old one, so uses before it stay attached to the certificate that was valid at the time.</T>
          </p>
          <a
            href={`/api/registers/usage-export?kind=${hit.kind}&id=${hit.id}`}
            className="mt-2 inline-block text-xs text-burgundy hover:underline"
          >
            <T>Export impacted inspections (CSV)</T>
          </a>
          {impactedRecords.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 ps-5">
              {impactedRecords.map((r) => (
                <li key={r.id}>
                  <Link href={`/inspect/inspections/${r.id}`} className="text-burgundy hover:underline">
                    {r.record_number}
                  </Link>{" "}
                  — {r.activity} · {new Date(r.inspection_date).toLocaleDateString("en-GB")} ({r.overall_result ?? "pending"})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <h3 className="mt-4 text-xs font-semibold uppercase text-muted">
        <T>Inspection answers verified against this entry (</T>{inspectionIds.size} <T>inspection</T>{inspectionIds.size === 1 ? "" : "s"})
      </h3>
      {usage.length === 0 ? (
        <p className="mt-1 text-sm text-muted"><T>No inspection checklist answer has been verified against this entry yet.</T></p>
      ) : (
        <div className="mt-2">
          <ResponsiveTable
            breakpoint="md"
            caption="Inspection answers verified against this entry"
            rows={usage}
            rowKey={(u) => u.id}
            headRowClassName="border-b border-border text-start text-xs uppercase text-muted"
            thClassName="py-2 pe-3"
            tdClassName="py-2 pe-3 align-top"
            columns={[
              {
                key: "record",
                header: "Record",
                render: (u) =>
                  u.record ? (
                    <Link href={`/inspect/inspections/${u.record.id}`} className="text-burgundy hover:underline">
                      {u.record.record_number}
                    </Link>
                  ) : (
                    "—"
                  ),
              },
              { key: "activity", header: "ITP activity", render: (u) => u.record?.activity ?? "—" },
              { key: "item", header: "Checklist item", className: "text-xs text-muted", render: (u) => (u.checklist_item ? `${u.checklist_item.item_number} ${u.checklist_item.description}` : "—") },
              { key: "date", header: "Date", className: "whitespace-nowrap text-xs text-muted", render: (u) => (u.record ? new Date(u.record.inspection_date).toLocaleDateString("en-GB") : "—") },
              { key: "answer", header: "Answer", className: "text-xs uppercase", render: (u) => u.result },
              { key: "result", header: "Result", render: (u) => u.record?.overall_result ?? "pending" },
            ]}
          />
        </div>
      )}
    </SectionCard>
  );
}
