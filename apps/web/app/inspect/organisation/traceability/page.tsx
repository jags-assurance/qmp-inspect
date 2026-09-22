import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AUDIT_LOG_TABLE, type AuditLogRow } from "@/lib/audit/types";
import { ITP_REVISIONS_TABLE } from "@/lib/itps/revision-types";

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
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const supabase = await createSupabaseServerClient();

  let itp: ItpMatch | null = null;
  let ncr: NcrMatch | null = null;
  let record: InspectionRecordMatch | null = null;
  let notFoundMessage: string | null = null;

  if (query) {
    itp = await findItp(supabase, query);
    if (!itp) ncr = await findNcr(supabase, query);
    if (!itp && !ncr) record = await findInspectionRecord(supabase, query);
    if (!itp && !ncr && !record) {
      notFoundMessage = `No ITP, NCR or inspection record found with document number "${query}".`;
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Document Traceability</h1>
      <p className="mt-1 text-sm text-muted">
        Look up any document number — an ITP, NCR or inspection report number — and see its full
        lineage: identity, revision history, related records and audit trail.
      </p>

      <form className="mt-6 flex max-w-xl gap-2">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="e.g. ABC-JAGS-ITP-2026-0001 or a NCR / IRN number"
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        <button
          type="submit"
          className="rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy/90"
        >
          Look up
        </button>
      </form>

      {notFoundMessage && (
        <p className="mt-6 rounded-md border border-border bg-surface p-4 text-sm text-muted">{notFoundMessage}</p>
      )}

      {itp && <ItpLineage supabase={supabase} itp={itp} />}
      {ncr && <NcrLineage supabase={supabase} ncr={ncr} />}
      {record && <InspectionRecordLineage supabase={supabase} record={record} />}
    </div>
  );
}

async function findItp(supabase: SupabaseClient, itpNumber: string): Promise<ItpMatch | null> {
  const { data } = await supabase
    .from("itps")
    .select(
      `id, itp_number, title, status, revision, phase, scope, applicable_standard, external_approval_reference,
       created_at,
       project:projects(id, project_number, name, organizations(name)),
       prepared_by_user:users!itps_prepared_by_fkey(full_name, email),
       approved_by_user:users!itps_approved_by_fkey(full_name, email),
       reviewed_by_user:users!itps_reviewed_by_fkey(full_name, email)`
    )
    .eq("itp_number", itpNumber)
    .maybeSingle<ItpMatch>();
  return data ?? null;
}

async function findNcr(supabase: SupabaseClient, ncrNumber: string): Promise<NcrMatch | null> {
  const { data } = await supabase
    .from("ncrs")
    .select(
      `id, ncr_number, description, severity, status, due_date, closed_at, created_at,
       itp_item_id, inspection_record_id,
       project:projects(id, project_number, name, organizations(name)),
       raised_by_user:users!ncrs_raised_by_fkey(full_name, email),
       assigned_to_user:users!ncrs_assigned_to_fkey(full_name, email),
       closed_by_user:users!ncrs_closed_by_fkey(full_name, email)`
    )
    .eq("ncr_number", ncrNumber)
    .maybeSingle<NcrMatch>();
  return data ?? null;
}

async function findInspectionRecord(supabase: SupabaseClient, recordNumber: string): Promise<InspectionRecordMatch | null> {
  const { data } = await supabase
    .from("inspection_records")
    .select(
      `id, record_number, itp_number, itp_item_id, activity, overall_result, inspection_date, location,
       client_name, applicable_standard, governing_drawing_reference, governing_drawing_revision, project_name,
       project:projects(id, project_number, name, organizations(name)),
       inspector:users!inspection_records_inspector_id_fkey(full_name, email)`
    )
    .eq("record_number", recordNumber)
    .maybeSingle<InspectionRecordMatch>();
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
      <span className="text-right text-ink">{value ?? "—"}</span>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6 rounded-lg border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function AuditTrailTable({ events }: { events: AuditEventRow[] }) {
  if (events.length === 0) return <p className="text-sm text-muted">No audit events recorded for this document.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase text-muted">
          <th className="py-2">Timestamp</th>
          <th className="py-2">Actor</th>
          <th className="py-2">Action</th>
          <th className="py-2">Summary</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id} className="border-b border-border last:border-0 align-top">
            <td className="whitespace-nowrap py-2 text-xs text-muted">{new Date(event.created_at).toLocaleString()}</td>
            <td className="py-2">
              {event.actor ? (
                <span>
                  {event.actor.full_name}
                  <span className="ml-1 text-xs text-muted">({event.actor.email})</span>
                </span>
              ) : (
                <span className="text-xs text-muted">System</span>
              )}
            </td>
            <td className="py-2 text-xs text-muted">{event.action}</td>
            <td className="py-2 text-ink">{event.summary}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function ItpLineage({ supabase, itp }: { supabase: SupabaseClient; itp: ItpMatch }) {
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
            Open full ITP →
          </Link>
        </p>
      </SectionCard>

      <SectionCard title="Revision history (R101)">
        {revisions.length === 0 ? (
          <p className="text-sm text-muted">No frozen revision snapshots yet — the ITP has not been issued.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {revisions.map((r) => (
              <li key={r.id} className="border-b border-border pb-2 last:border-0">
                <span className="font-medium text-ink">Rev {r.revision}</span> — {r.title}
                <div className="text-xs text-muted">
                  {r.reason ?? "No reason recorded"} · {new Date(r.created_at).toLocaleString()}
                  {r.created_by_user ? ` · ${r.created_by_user.full_name}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={`Related inspection records (${relatedInspections.length})`}>
        {relatedInspections.length === 0 ? (
          <p className="text-sm text-muted">No inspection records reference an item on this ITP.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {relatedInspections.map((r) => (
              <li key={r.id}>
                <Link href={`/inspect/inspections/${r.id}`} className="text-burgundy hover:underline">
                  {r.record_number}
                </Link>{" "}
                — {r.activity} ({r.overall_result ?? "pending"}) · {new Date(r.inspection_date).toLocaleDateString()}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={`Related NCRs (${relatedNcrs.length})`}>
        {relatedNcrs.length === 0 ? (
          <p className="text-sm text-muted">No NCRs reference an item on this ITP.</p>
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

      <SectionCard title="Audit trail (R102)">
        <AuditTrailTable events={auditEvents} />
      </SectionCard>
    </>
  );
}

async function NcrLineage({ supabase, ncr }: { supabase: SupabaseClient; ncr: NcrMatch }) {
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
        <IdentityRow label="Due date" value={ncr.due_date ? new Date(ncr.due_date).toLocaleDateString() : null} />
        <IdentityRow label="Closed by" value={ncr.closed_by_user?.full_name} />
        <IdentityRow label="Closed at" value={ncr.closed_at ? new Date(ncr.closed_at).toLocaleString() : null} />
        <p className="mt-3">
          <Link href={`/inspect/ncrs/${ncr.id}`} className="text-sm text-burgundy hover:underline">
            Open full NCR →
          </Link>
        </p>
      </SectionCard>

      <SectionCard title="Raised against">
        {!sourceItp && !sourceInspection && (
          <p className="text-sm text-muted">
            This NCR was not raised against a specific ITP item or inspection record (both links are
            optional on the ncrs table).
          </p>
        )}
        {sourceItp && (
          <p className="text-sm">
            ITP:{" "}
            <Link href={`/inspect/itps/${sourceItp.id}`} className="text-burgundy hover:underline">
              {sourceItp.itp_number}
            </Link>{" "}
            — {sourceItp.title} ({sourceItp.status})
          </p>
        )}
        {sourceInspection && (
          <p className="mt-2 text-sm">
            Inspection record:{" "}
            <Link href={`/inspect/inspections/${sourceInspection.id}`} className="text-burgundy hover:underline">
              {sourceInspection.record_number}
            </Link>{" "}
            — {sourceInspection.activity} ({sourceInspection.overall_result ?? "pending"})
          </p>
        )}
      </SectionCard>

      <SectionCard title="Audit trail (R102)">
        <AuditTrailTable events={auditEvents} />
      </SectionCard>
    </>
  );
}

async function InspectionRecordLineage({ supabase, record }: { supabase: SupabaseClient; record: InspectionRecordMatch }) {
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
        <IdentityRow label="Inspection date" value={new Date(record.inspection_date).toLocaleDateString()} />
        <IdentityRow label="Inspector" value={record.inspector?.full_name} />
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
            Open full inspection record →
          </Link>
        </p>
      </SectionCard>

      <SectionCard title="Governing ITP">
        {sourceItp ? (
          <p className="text-sm">
            <Link href={`/inspect/itps/${sourceItp.id}`} className="text-burgundy hover:underline">
              {sourceItp.itp_number}
            </Link>{" "}
            — {sourceItp.title} ({sourceItp.status}). Frozen at inspection time as{" "}
            <span className="doc-id">{record.itp_number}</span>.
          </p>
        ) : (
          <p className="text-sm text-muted">
            The governing ITP item could not be resolved (frozen number was{" "}
            <span className="doc-id">{record.itp_number}</span>).
          </p>
        )}
      </SectionCard>

      <SectionCard title={`Related NCRs (${(relatedNcrs ?? []).length})`}>
        {(relatedNcrs ?? []).length === 0 ? (
          <p className="text-sm text-muted">No NCRs reference this inspection record.</p>
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

      <SectionCard title="Audit trail (R102)">
        <AuditTrailTable events={auditEvents} />
      </SectionCard>
    </>
  );
}
