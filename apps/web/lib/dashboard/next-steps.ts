import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE, type SignoffStatus } from "@/lib/signoff/db-types";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";
import { buildActivityFlow, flowPosition, type FlowLevel, type StageState } from "@/lib/itps/flow";

/**
 * "Your next steps" for a dashboard: the few activities where it is this person's turn (or, for JAGS staff, where
 * somebody still has to be asked), each with where it sits in the order of sign-offs. Read-only and RLS-scoped; it
 * reuses the sign-off rows and the ordering rule the ITP page already shows.
 */

export type NextStepKind = "sign_off" | "notify";

export interface NextStepItem {
  /** activity_signoff_progress id */
  id: string;
  kind: NextStepKind;
  activity: string;
  itpNumber: string;
  projectName: string | null;
  /** Opens the ITP with this activity's side panel. */
  href: string;
  /** The activity's stages, for the small progress strip. */
  stages: { code: string; label: string; state: StageState; hasYou: boolean }[];
  /** "Step 2 of 3" and the plain sentence, when the viewer has a step on the activity. */
  position: { index: number; total: number; text: string } | null;
}

interface ProgressRow {
  id: string;
  itp_item_id: string;
  intervention: string;
  status: SignoffStatus;
  project_party_id: string;
  itp_items: {
    id: string;
    activity: string;
    itp_sections: { itps: { id: string; itp_number: string; projects: { name: string; organization_id: string } | null } | null } | null;
  } | null;
}

export async function loadNextSteps(
  supabase: SupabaseClient,
  opts: { partyIds: string[]; staff: boolean; limit?: number }
): Promise<{ items: NextStepItem[]; total: number }> {
  const limit = opts.limit ?? 5;
  const select =
    "id, itp_item_id, intervention, status, project_party_id, itp_items(id, activity, itp_sections(itps(id, itp_number, projects(name, organization_id))))";

  // Rows where it is the viewer's turn: notified, on one of their parties. Staff: the JAGS party's own cells.
  let yours: ProgressRow[] = [];
  let yourTotal = 0;
  if (opts.partyIds.length > 0) {
    const { data, count, error } = await supabase
      .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
      .select(select, { count: "exact" })
      .in("project_party_id", opts.partyIds)
      .eq("status", "notified")
      .order("notified_at", { ascending: true, nullsFirst: false })
      .limit(limit)
      .returns<ProgressRow[]>();
    if (error) throw new Error(`Could not load your next steps: ${error.message}`);
    yours = data ?? [];
    yourTotal = count ?? yours.length;
  }

  // Staff also need to know where nobody has been asked yet (the Notify step is theirs).
  let toNotify: ProgressRow[] = [];
  let toNotifyTotal = 0;
  if (opts.staff && yours.length < limit) {
    const { data, count, error } = await supabase
      .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
      .select(select, { count: "exact" })
      .eq("status", "pending")
      .limit(limit - yours.length)
      .returns<ProgressRow[]>();
    if (error) throw new Error(`Could not load the sign-offs to notify: ${error.message}`);
    toNotify = data ?? [];
    toNotifyTotal = count ?? toNotify.length;
  } else if (opts.staff) {
    const { count } = await supabase
      .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    toNotifyTotal = count ?? 0;
  }

  const picked: { row: ProgressRow; kind: NextStepKind }[] = [
    ...yours.map((row) => ({ row, kind: "sign_off" as const })),
    ...toNotify.map((row) => ({ row, kind: "notify" as const })),
  ];
  if (picked.length === 0) return { items: [], total: yourTotal + toNotifyTotal };

  // One batched read for the other parties on those activities, and for the level order of their organisations.
  const itemIds = [...new Set(picked.map((p) => p.row.itp_item_id))];
  const orgIds = [...new Set(picked.map((p) => p.row.itp_items?.itp_sections?.itps?.projects?.organization_id).filter((x): x is string => !!x))];
  const [{ data: allRows, error: rowsError }, { data: levelRows }, { data: orgRows }] = await Promise.all([
    supabase
      .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
      .select("itp_item_id, intervention, status, project_party_id, project_parties(name)")
      .in("itp_item_id", itemIds)
      .returns<{ itp_item_id: string; intervention: string; status: SignoffStatus; project_party_id: string; project_parties: { name: string } | null }[]>(),
    supabase
      .from(INTERVENTION_LEVEL_TYPES_TABLE)
      .select("organization_id, code, label, sort_order, is_blocking")
      .in("organization_id", orgIds)
      .returns<(FlowLevel & { organization_id: string })[]>(),
    supabase.from("organizations").select("id, itp_sequencing_mode").in("id", orgIds).returns<{ id: string; itp_sequencing_mode: string }[]>(),
  ]);
  if (rowsError) throw new Error(`Could not load the steps around your next steps: ${rowsError.message}`);

  const yourParties = new Set(opts.partyIds);
  const items: NextStepItem[] = picked.map(({ row, kind }) => {
    const itp = row.itp_items?.itp_sections?.itps;
    const orgId = itp?.projects?.organization_id ?? "";
    const levels = (levelRows ?? []).filter((l) => l.organization_id === orgId);
    const strict = (orgRows ?? []).find((o) => o.id === orgId)?.itp_sequencing_mode === "strict";
    const stages = buildActivityFlow(
      (allRows ?? [])
        .filter((r) => r.itp_item_id === row.itp_item_id)
        .map((r) => ({
          partyId: r.project_party_id,
          partyName: r.project_parties?.name ?? "A party",
          intervention: r.intervention,
          status: r.status,
          isYou: yourParties.has(r.project_party_id),
        })),
      levels,
      strict
    );
    return {
      id: row.id,
      kind,
      activity: row.itp_items?.activity ?? "Activity",
      itpNumber: itp?.itp_number ?? "",
      projectName: itp?.projects?.name ?? null,
      href: itp ? `/inspect/itps/${itp.id}?activity=${row.itp_item_id}` : "/inspect/itps",
      stages: stages.map((s) => ({ code: s.code, label: s.label, state: s.state, hasYou: s.steps.some((st) => st.isYou) })),
      position: flowPosition(stages),
    };
  });
  return { items, total: yourTotal + toNotifyTotal };
}
