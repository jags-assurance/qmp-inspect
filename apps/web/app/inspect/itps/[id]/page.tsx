import { Fragment } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { InterventionSelect } from "@/components/domain/intervention-select";
import { SignoffCell } from "@/components/domain/signoff-cell";
import { advanceItpStatusAction, acceptItpAction } from "@/lib/itps/actions";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE, type ActivitySignoffProgressRow } from "@/lib/signoff/db-types";
import type { InterventionLevel } from "@jags/shared-types";
import { AddItemForm } from "./add-item-form";
// Added for the "propose to master library" action (Reqs R31) — no other change to this file.
import { ITP_MASTER_TEMPLATES_TABLE } from "@/lib/itp-master/types";
import { ProposeToMasterForm } from "./propose-to-master-form";
// Added for R54-R56 "expected -> received" third-party test record tracking — no other change to
// this file beyond the query below and rendering ExpectedRecordsSection per activity.
import {
  ACTIVITY_EXPECTED_RECORDS_TABLE,
  PROVIDER_TO_PARTY_TYPES,
  type ActivityExpectedRecordRow,
  type ExpectedRecordProvider,
} from "@/lib/expected-records/db-types";
import { ExpectedRecordsSection } from "./expected-record-form";

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "gold"> = {
  draft: "neutral",
  under_review: "warning",
  approved: "gold",
  client_accepted: "success",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  under_review: "Under review",
  approved: "Approved",
  client_accepted: "Client accepted",
};

// Simple visual stepper for the ITP's approval lifecycle — purely presentational, mirrors the
// status values above (client_accepted renders as a completed "Approved" step plus its own badge).
const STATUS_STEPS: { key: string; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "under_review", label: "Review" },
  { key: "approved", label: "Approved" },
];

function statusStepIndex(status: string): number {
  if (status === "client_accepted") return 2;
  return STATUS_STEPS.findIndex((s) => s.key === status);
}

const EVIDENCE_LABEL: Record<number, string> = {
  1: "Checklist",
  2: "Document upload",
  3: "Measurement record",
};

// R66-R81 defaults, mirrored from apps/web/lib/signoff/actions.ts (used only when a project has no
// notice_period_configs row for that intervention).
const DEFAULT_NOTICE_PERIOD_HOURS: Record<"H" | "W", number> = { H: 48, W: 24 };

export default async function ItpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: itp } = await supabase
    .from("itps")
    .select("*, projects(id, name, organization_id, organizations(name))")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      itp_number: string;
      title: string;
      scope: string | null;
      applicable_standard: string | null;
      revision: number;
      status: "draft" | "under_review" | "approved" | "client_accepted";
      projects: { id: string; name: string; organization_id: string; organizations: { name: string } | null } | null;
    }>();

  if (!itp) notFound();

  interface SectionWithItems {
    id: string;
    section_number: number;
    title: string;
    itp_items: {
      id: string;
      item_number: string;
      activity: string;
      acceptance_criteria: string | null;
      evidence_type: 1 | 2 | 3;
      sort_order: number;
      discipline_id: string | null;
    }[];
  }

  const canPropose = session.isJagsStaff && (itp.status === "approved" || itp.status === "client_accepted");

  const [{ data: sections }, { data: parties }, { data: interventions }, { data: signoffs }, { data: noticeConfigs }, { data: masterTemplates }, { data: disciplines }] =
    await Promise.all([
      supabase
        .from("itp_sections")
        .select(
          "id, section_number, title, itp_items(id, item_number, activity, acceptance_criteria, evidence_type, sort_order, discipline_id)"
        )
        .eq("itp_id", id)
        .order("section_number")
        .returns<SectionWithItems[]>(),
      supabase
        .from("project_parties")
        .select("id, party_type, name, user_id")
        .eq("project_id", itp.projects?.id ?? "")
        .order("party_type")
        .returns<{ id: string; party_type: string; name: string; user_id: string | null }[]>(),
      supabase
        .from("activity_party_intervention")
        .select("itp_item_id, project_party_id, intervention"),
      // Sign-off state alongside the H/W/R/S grid (R66-R81) — same query-building pattern as the
      // activity_party_intervention query above, just against the sibling progress table.
      supabase
        .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
        .select("id, itp_item_id, project_party_id, intervention, status, notified_at")
        .returns<Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "project_party_id" | "intervention" | "status" | "notified_at">[]>(),
      supabase
        .from("notice_period_configs")
        .select("intervention, hours")
        .eq("project_id", itp.projects?.id ?? "")
        .returns<{ intervention: "H" | "W"; hours: number }[]>(),
      // Only used to populate the "update existing" picker in the propose-to-master form below;
      // querying unconditionally keeps this straightforward, and the table is tiny.
      canPropose
        ? supabase
            .from(ITP_MASTER_TEMPLATES_TABLE)
            .select("id, title")
            .eq("is_active", true)
            .order("title")
            .returns<{ id: string; title: string }[]>()
        : Promise.resolve({ data: [] as { id: string; title: string }[] }),
      supabase
        .from("master_disciplines")
        .select("id, code, name")
        .eq("is_active", true)
        .order("sort_order")
        .returns<{ id: string; code: string; name: string }[]>(),
    ]);

  // R54-R56 expected records: fetched separately from the Promise.all above since it needs the
  // item ids that come out of the `sections` query first.
  const allItemIds = (sections ?? []).flatMap((s) => (s.itp_items ?? []).map((it) => it.id));
  const { data: expectedRecords } = allItemIds.length
    ? await supabase
        .from(ACTIVITY_EXPECTED_RECORDS_TABLE)
        .select("id, itp_item_id, provider, record_type, document_number, storage_path, received_at, created_at")
        .in("itp_item_id", allItemIds)
        .order("created_at")
        .returns<ActivityExpectedRecordRow[]>()
    : { data: [] as ActivityExpectedRecordRow[] };

  const expectedRecordsByItem = new Map<string, ActivityExpectedRecordRow[]>();
  for (const record of expectedRecords ?? []) {
    const list = expectedRecordsByItem.get(record.itp_item_id) ?? [];
    list.push(record);
    expectedRecordsByItem.set(record.itp_item_id, list);
  }

  // A party can mark their own provider's record received if their login is linked to a
  // project_parties row of that party_type (mirrors canSignOffForParty) — staff always can. Computed
  // as a plain object (not a function) since a Server Component can never pass a function to a
  // Client Component as a prop — only Server Actions cross that boundary.
  const ownPartyTypes = new Set((parties ?? []).filter((p) => p.user_id === session.userId).map((p) => p.party_type));
  const canMarkReceivedByProvider: Record<ExpectedRecordProvider, boolean> = {
    jags: session.isJagsStaff || PROVIDER_TO_PARTY_TYPES.jags.some((pt) => ownPartyTypes.has(pt)),
    tpi: session.isJagsStaff || PROVIDER_TO_PARTY_TYPES.tpi.some((pt) => ownPartyTypes.has(pt)),
    contractor: session.isJagsStaff || PROVIDER_TO_PARTY_TYPES.contractor.some((pt) => ownPartyTypes.has(pt)),
  };

  const disciplineByid = new Map((disciplines ?? []).map((d) => [d.id, d.code]));

  const interventionMap = new Map<string, InterventionLevel>();
  for (const row of interventions ?? []) {
    interventionMap.set(`${row.itp_item_id}:${row.project_party_id}`, row.intervention as InterventionLevel);
  }

  const signoffMap = new Map<string, NonNullable<typeof signoffs>[number]>();
  for (const row of signoffs ?? []) {
    signoffMap.set(`${row.itp_item_id}:${row.project_party_id}`, row);
  }

  const noticeHours: Record<"H" | "W", number> = { ...DEFAULT_NOTICE_PERIOD_HOURS };
  for (const config of noticeConfigs ?? []) {
    noticeHours[config.intervention] = config.hours;
  }

  const canEditContent = session.isJagsStaff;
  // Client acceptance is that specific party's own action — not "any non-staff login," which the
  // end-to-end walkthrough flagged as too broad (a subcontractor/main contractor/TPI login could
  // technically have hit the same button). Mirrors accept_itp()'s own check at the database layer.
  const isLinkedClientParty = (parties ?? []).some((p) => p.party_type === "client" && p.user_id === session.userId);
  const canAccept = isLinkedClientParty && itp.status === "approved";

  // Role-based restriction (R66-R81): a party's sign-off is theirs to give, not anyone's on the
  // project — staff can always countersign, an external user only for the party their own login is
  // linked to via project_parties.user_id (see lib/signoff/actions.ts's canSignOffForParty, the
  // server-side twin of this check).
  const canSignOffFor = (partyUserId: string | null) => session.isJagsStaff || (!!partyUserId && partyUserId === session.userId);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="doc-id text-2xl font-semibold text-ink">{itp.itp_number}</h1>
            <Badge tone={STATUS_TONE[itp.status]}>{STATUS_LABEL[itp.status]}</Badge>
            <span className="text-sm text-muted">Rev {itp.revision}</span>
          </div>
          <p className="mt-1 text-lg text-ink">{itp.title}</p>
          <p className="mt-1 text-sm text-muted">
            {itp.projects?.organizations?.name} · {itp.projects?.name}
            {itp.applicable_standard ? ` · ${itp.applicable_standard}` : ""}
          </p>

          <ol className="mt-3 flex items-center gap-2">
            {STATUS_STEPS.map((step, i) => {
              const current = statusStepIndex(itp.status);
              const done = i <= current;
              return (
                <li key={step.key} className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                      done ? "bg-burgundy/10 text-burgundy" : "bg-muted/10 text-muted"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${done ? "bg-burgundy" : "bg-muted/40"}`}
                      aria-hidden
                    />
                    {step.label}
                  </span>
                  {i < STATUS_STEPS.length - 1 && <span className="h-px w-4 bg-border" aria-hidden />}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="flex gap-2">
          {/* Added by the checklists/inspections slice — links to the new /checklists route added in that feature, no other change to this file. */}
          <Link
            href={`/inspect/itps/${itp.id}/checklists`}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
          >
            Checklists →
          </Link>
          {canEditContent && itp.status === "draft" && (
            <form action={advanceItpStatusAction}>
              <input type="hidden" name="itp_id" value={itp.id} />
              <input type="hidden" name="from_status" value="draft" />
              <button type="submit" className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white">
                Submit for review
              </button>
            </form>
          )}
          {canEditContent && itp.status === "under_review" && (
            <form action={advanceItpStatusAction}>
              <input type="hidden" name="itp_id" value={itp.id} />
              <input type="hidden" name="from_status" value="under_review" />
              <button type="submit" className="rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark">
                Approve
              </button>
            </form>
          )}
          {canAccept && (
            <form action={acceptItpAction}>
              <input type="hidden" name="itp_id" value={itp.id} />
              <button type="submit" className="rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark">
                Accept ITP
              </button>
            </form>
          )}
          {/* Added for the "propose to master library" action (Reqs R31) — only shown once the ITP
              has reached approved/client_accepted, matching this file's existing status gating. */}
          {canPropose && (
            <ProposeToMasterForm itpId={itp.id} itpTitle={itp.title} masterTemplates={masterTemplates ?? []} />
          )}
        </div>
      </div>

      <div className="mt-8 space-y-8">
        {(sections ?? []).map((section) => (
          <div key={section.id} className="rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-medium text-ink">
                {section.section_number}. {section.title}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 font-medium">Activity</th>
                    <th className="px-3 py-2 font-medium">Acceptance criteria</th>
                    <th className="px-3 py-2 font-medium">Evidence</th>
                    <th className="px-3 py-2 font-medium">Discipline</th>
                    {(parties ?? []).map((party) => (
                      <th key={party.id} className="px-2 py-2 text-center font-medium">
                        {party.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...(section.itp_items ?? [])]
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((item) => (
                      <Fragment key={item.id}>
                        <tr className="border-b border-border last:border-0">
                          <td className="doc-id px-3 py-2 text-ink">{item.item_number}</td>
                          <td className="px-3 py-2 text-ink">{item.activity}</td>
                          <td className="px-3 py-2 text-muted">{item.acceptance_criteria ?? "—"}</td>
                          <td className="px-3 py-2 text-muted">{EVIDENCE_LABEL[item.evidence_type]}</td>
                          <td className="px-3 py-2 text-muted">
                            {item.discipline_id ? (
                              <Badge tone="neutral">{disciplineByid.get(item.discipline_id) ?? "—"}</Badge>
                            ) : (
                              "—"
                            )}
                          </td>
                          {(parties ?? []).map((party) => {
                            const intervention = interventionMap.get(`${item.id}:${party.id}`) ?? null;
                            const signoff = signoffMap.get(`${item.id}:${party.id}`) ?? null;
                            return (
                              <td key={party.id} className="px-2 py-2 text-center">
                                <div className="flex flex-col items-center gap-1">
                                  <InterventionSelect
                                    itpId={itp.id}
                                    itpItemId={item.id}
                                    projectPartyId={party.id}
                                    value={intervention}
                                    editable={canEditContent}
                                  />
                                  {intervention && signoff && (
                                    <SignoffCell
                                      progressId={signoff.id}
                                      intervention={intervention}
                                      status={signoff.status}
                                      notifiedAt={signoff.notified_at}
                                      noticeHours={noticeHours[intervention as "H" | "W"] ?? null}
                                      canSignOff={canSignOffFor(party.user_id)}
                                      isJagsStaff={session.isJagsStaff}
                                    />
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                        {/* R54-R56: expected -> received third-party test record tracking per activity. */}
                        <tr key={`${item.id}-expected-records`} className="border-b border-border last:border-0 bg-off-white/40">
                          <td colSpan={5 + (parties ?? []).length} className="p-0">
                            <ExpectedRecordsSection
                              itpItemId={item.id}
                              records={expectedRecordsByItem.get(item.id) ?? []}
                              canAdd={session.isJagsStaff}
                              canMarkReceivedByProvider={canMarkReceivedByProvider}
                              projectId={itp.projects?.id ?? ""}
                            />
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  {(section.itp_items ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5 + (parties ?? []).length} className="px-3 py-6 text-center text-muted">
                        No activities in this section yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {canEditContent && (
              <AddItemForm itpId={itp.id} sectionId={section.id} disciplines={disciplines ?? []} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
