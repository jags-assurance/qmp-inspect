// Deliberately NOT "use server": these take a live Supabase client (not serializable) and must only
// be called from other server actions (issueIrnAction / voidIrnAction / reopen action).

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { createNotification } from "@/lib/notifications/helpers";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// project_party_members is not in the generated shared-types yet; regenerate types and drop this.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untypedFrom = (client: Supabase, table: string) => (client as any).from(table);

interface RecordContext {
  recordNumber: string;
  projectId: string;
  organizationId: string;
  itpId: string | null;
  itpNumber: string;
  activity: string;
  overallResult: string | null;
  itpItemId: string;
}

async function loadContext(supabase: Supabase, inspectionRecordId: string): Promise<RecordContext | null> {
  const { data: rec } = await supabase
    .from("inspection_records")
    .select("record_number, project_id, itp_item_id, itp_number, activity, overall_result")
    .eq("id", inspectionRecordId)
    .maybeSingle<{ record_number: string; project_id: string; itp_item_id: string; itp_number: string; activity: string; overall_result: string | null }>();
  if (!rec) return null;
  const [{ data: project }, { data: item }] = await Promise.all([
    supabase.from("projects").select("organization_id").eq("id", rec.project_id).maybeSingle<{ organization_id: string }>(),
    supabase
      .from("itp_items")
      .select("itp_sections(itp_id)")
      .eq("id", rec.itp_item_id)
      .maybeSingle<{ itp_sections: { itp_id: string } | null }>(),
  ]);
  if (!project) return null;
  return {
    recordNumber: rec.record_number,
    projectId: rec.project_id,
    organizationId: project.organization_id,
    itpId: item?.itp_sections?.itp_id ?? null,
    itpNumber: rec.itp_number,
    activity: rec.activity,
    overallResult: rec.overall_result,
    itpItemId: rec.itp_item_id,
  };
}

/** User ids for a set of project parties: the party's primary login plus its team members. */
async function userIdsForParties(supabase: Supabase, partyIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (partyIds.length === 0) return out;
  const [{ data: parties }, { data: members }] = await Promise.all([
    supabase.from("project_parties").select("user_id").in("id", partyIds).returns<{ user_id: string | null }[]>(),
    untypedFrom(supabase, "project_party_members")
      .select("user_id")
      .in("project_party_id", partyIds) as Promise<{ data: { user_id: string | null }[] | null }>,
  ]);
  for (const p of parties ?? []) if (p.user_id) out.add(p.user_id);
  for (const m of members ?? []) if (m.user_id) out.add(m.user_id);
  return out;
}

async function collectRecipients(supabase: Supabase, ctx: RecordContext): Promise<Set<string>> {
  const partyIds = new Set<string>();

  // Parties holding a still-open hold/witness point on the same ITP (the work this release unblocks).
  if (ctx.itpId) {
    const { data: items } = await supabase
      .from("itp_items")
      .select("id, itp_sections!inner(itp_id)")
      .eq("itp_sections.itp_id", ctx.itpId)
      .returns<{ id: string }[]>();
    const itemIds = (items ?? []).map((i) => i.id);
    if (itemIds.length > 0) {
      const { data: progress } = await supabase
        .from("activity_signoff_progress")
        .select("project_party_id")
        .in("itp_item_id", itemIds)
        .in("status", ["pending", "notified"])
        .in("intervention", ["H", "W"])
        .returns<{ project_party_id: string }[]>();
      for (const p of progress ?? []) partyIds.add(p.project_party_id);
    }
  }

  // Client party users.
  const { data: clients } = await supabase
    .from("project_parties")
    .select("id")
    .eq("project_id", ctx.projectId)
    .eq("party_type", "client")
    .eq("is_active", true)
    .returns<{ id: string }[]>();
  for (const c of clients ?? []) partyIds.add(c.id);

  return userIdsForParties(supabase, [...partyIds]);
}

async function actorId(supabase: Supabase): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function fanOut(
  supabase: Supabase,
  ctx: RecordContext,
  inspectionRecordId: string,
  recipients: Set<string>,
  title: string,
  body: string
) {
  const me = await actorId(supabase);
  const link = `/inspect/inspections/${inspectionRecordId}`;
  await Promise.all(
    [...recipients]
      .filter((uid) => uid !== me)
      .map((uid) =>
        createNotification(supabase, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          recipientUserId: uid,
          title,
          body,
          link,
        }).catch(() => undefined)
      )
  );
}

/** Call after an IRN is successfully issued. Best-effort; never throws. */
export async function notifyAfterIrnIssued(supabase: Supabase, inspectionRecordId: string, irnNumber?: string): Promise<void> {
  try {
    const ctx = await loadContext(supabase, inspectionRecordId);
    if (!ctx) return;
    const recipients = await collectRecipients(supabase, ctx);
    const itpLink = ctx.itpId ? ` ITP: /inspect/itps/${ctx.itpId}` : "";
    const conditional = ctx.overallResult === "partial";
    await fanOut(
      supabase,
      ctx,
      inspectionRecordId,
      recipients,
      conditional ? "Conditional release — inspection passed with conditions" : "Hold released — inspection passed",
      `${ctx.itpNumber} — ${ctx.activity}: inspection ${ctx.recordNumber} ${conditional ? "passed conditionally" : "passed"}${irnNumber ? ` and ${irnNumber} was issued` : ""}.${itpLink}`
    );
  } catch {
    // Best-effort.
  }
}

/** Extra void recipients: the IRN issuer, the party executing this activity, and the main contractor
 *  and TPI parties on the ITP (plus their team members). */
async function collectVoidExtraRecipients(supabase: Supabase, ctx: RecordContext, inspectionRecordId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const { data: irnRows } = await supabase
    .from("irns")
    .select("issued_by")
    .eq("inspection_record_id", inspectionRecordId)
    .returns<{ issued_by: string | null }[]>();
  for (const r of irnRows ?? []) if (r.issued_by) out.add(r.issued_by);

  const partyIds = new Set<string>();
  type PartyRow = { project_parties: { id: string; party_type: string; is_active: boolean } | null };
  const { data: onItem } = await supabase
    .from("activity_party_intervention")
    .select("project_parties(id, party_type, is_active)")
    .eq("itp_item_id", ctx.itpItemId)
    .returns<PartyRow[]>();
  for (const row of onItem ?? []) {
    const p = row.project_parties;
    if (p?.is_active && (p.party_type === "subcontractor" || p.party_type === "main_contractor")) partyIds.add(p.id);
  }
  if (ctx.itpId) {
    const { data: items } = await supabase
      .from("itp_items")
      .select("id, itp_sections!inner(itp_id)")
      .eq("itp_sections.itp_id", ctx.itpId)
      .returns<{ id: string }[]>();
    const itemIds = (items ?? []).map((i) => i.id);
    if (itemIds.length > 0) {
      const { data: onItp } = await supabase
        .from("activity_party_intervention")
        .select("project_parties(id, party_type, is_active)")
        .in("itp_item_id", itemIds)
        .returns<PartyRow[]>();
      for (const row of onItp ?? []) {
        const p = row.project_parties;
        if (p?.is_active && (p.party_type === "main_contractor" || p.party_type === "tpi_lab")) partyIds.add(p.id);
      }
    }
  }
  for (const uid of await userIdsForParties(supabase, [...partyIds])) out.add(uid);
  return out;
}

/** Call after an IRN is voided. Best-effort; never throws. */
export async function notifyAfterIrnVoided(
  supabase: Supabase,
  inspectionRecordId: string,
  irnNumber: string,
  reason: string
): Promise<void> {
  try {
    const ctx = await loadContext(supabase, inspectionRecordId);
    if (!ctx) return;
    const recipients = await collectRecipients(supabase, ctx);
    for (const uid of await collectVoidExtraRecipients(supabase, ctx, inspectionRecordId)) recipients.add(uid);
    await fanOut(
      supabase,
      ctx,
      inspectionRecordId,
      recipients,
      "IRN voided — release withdrawn",
      `${ctx.itpNumber} — ${ctx.activity}: ${irnNumber} was voided. ${reason}`
    );
  } catch {
    // Best-effort.
  }
}

/** Notify the original inspector that their completed inspection was re-opened. */
export async function notifyInspectorReopened(
  supabase: Supabase,
  inspectionRecordId: string,
  inspectorId: string | null,
  reason: string
): Promise<void> {
  try {
    if (!inspectorId) return;
    const ctx = await loadContext(supabase, inspectionRecordId);
    if (!ctx) return;
    await createNotification(supabase, {
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      recipientUserId: inspectorId,
      title: "Inspection re-opened",
      body: `${ctx.recordNumber} (${ctx.activity}) was re-opened for amendment. Reason: ${reason}`,
      link: `/inspect/inspections/${inspectionRecordId}`,
    });
  } catch {
    // Best-effort.
  }
}
