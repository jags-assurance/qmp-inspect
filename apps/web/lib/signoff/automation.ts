// Deliberately NOT "use server": plain server-only helpers called from server actions and the cron
// route, never callable from a client. All decisions live in ./automation-logic.ts (pure, tested);
// this file only reads, applies and records.
//
// Phase 2 automation, both parts gated per organisation (organizations.auto_notify_signoffs /
// auto_proceed_after_notice, default off, migration 20261212000100). When a column does not exist yet
// the flags read as off, so nothing runs.
//
//  1. Auto-notify: pending rows whose level is now eligible get notified through the same shared
//     notify code as the manual "Notify all pending" button (notifyPendingRowsBulk).
//  2. Auto-proceed: a notified Witness/Surveillance row past its notice period becomes
//     'proceeded_no_response' (never Hold/Review, never signed_off).

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { recordAuditEvent } from "@/lib/audit/log";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE, NOTICE_PERIOD_CONFIGS_TABLE } from "./db-types";
import { notifyPendingRowsBulk } from "./notify-row";
import {
  AUTOMATION_OFF,
  isItpOpenForSignoff,
  parseAutomationFlags,
  resolveNoticeHours,
  selectRowsToAutoNotify,
  selectRowsToAutoProceed,
  type AutomationFlags,
  type AutomationRow,
  type LevelInfo,
} from "./automation-logic";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface AutomationResult {
  notified: number;
  proceeded: number;
}

const NOTHING: AutomationResult = { notified: 0, proceeded: 0 };

/** Reads the org's switches. Missing columns or any read error mean "off". */
export async function getOrganizationAutomationFlags(supabase: Client, organizationId: string): Promise<AutomationFlags> {
  const { data, error } = await supabase
    .from("organizations")
    .select("auto_notify_signoffs, auto_proceed_after_notice")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) {
    if (!isMissingSchemaError(error)) console.error("[signoff-automation] could not read organisation flags:", error.message);
    return AUTOMATION_OFF;
  }
  return parseAutomationFlags(data as { auto_notify_signoffs?: unknown; auto_proceed_after_notice?: unknown } | null);
}

/** The system acts on its own here, so prefer the service role (the approver/signer's own RLS may not
 *  let them update another party's row); without it fall back to the caller's session client. */
async function automationClient(): Promise<Client> {
  if (isServiceRoleConfigured()) return createSupabaseServiceRoleClient() as unknown as Client;
  return createSupabaseServerClient();
}

interface ItpContext {
  status: string;
  itpNumber: string;
  projectId: string;
  organizationId: string;
}

/** Applies both automations to one ITP. Never throws. */
export async function runSignoffAutomationForItp(itpId: string, existingClient?: Client): Promise<AutomationResult> {
  try {
    const supabase = existingClient ?? (await automationClient());
    return await runForItp(supabase, itpId);
  } catch (err) {
    console.error("[signoff-automation] failed for ITP", itpId, err);
    return NOTHING;
  }
}

/** Same, starting from an activity (used after a sign-off or proceed on that activity). */
export async function runSignoffAutomationForItem(itpItemId: string): Promise<AutomationResult> {
  try {
    const supabase = await automationClient();
    const { data } = await supabase
      .from("itp_items")
      .select("itp_sections(itp_id)")
      .eq("id", itpItemId)
      .maybeSingle<{ itp_sections: { itp_id: string } | null }>();
    const itpId = data?.itp_sections?.itp_id;
    if (!itpId) return NOTHING;
    return await runSignoffAutomationForItp(itpId, supabase);
  } catch (err) {
    console.error("[signoff-automation] failed for item", itpItemId, err);
    return NOTHING;
  }
}

async function runForItp(supabase: Client, itpId: string): Promise<AutomationResult> {
  const { data: itpRow } = await supabase
    .from("itps")
    .select("status, itp_number, project_id, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{ status: string; itp_number: string; project_id: string; projects: { organization_id: string } | null }>();
  const organizationId = itpRow?.projects?.organization_id;
  if (!itpRow || !organizationId || !isItpOpenForSignoff(itpRow.status)) return NOTHING;
  const itp: ItpContext = { status: itpRow.status, itpNumber: itpRow.itp_number, projectId: itpRow.project_id, organizationId };

  const flags = await getOrganizationAutomationFlags(supabase, organizationId);
  if (!flags.autoNotify && !flags.autoProceed) return NOTHING;

  const { data: sections } = await supabase
    .from("itp_sections")
    .select("itp_items(id, activity, notice_hours_override)")
    .eq("itp_id", itpId)
    .returns<{ itp_items: { id: string; activity: string; notice_hours_override: number | null }[] }[]>();
  const items = (sections ?? []).flatMap((s) => s.itp_items ?? []);
  if (items.length === 0) return NOTHING;
  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemIds = items.map((i) => i.id);

  const ROW_COLS = "id, itp_item_id, project_party_id, intervention, status, notified_at";
  let { data: rowData, error: rowError } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .select(`${ROW_COLS}, rejected_at`)
    .in("itp_item_id", itemIds)
    .returns<AutomationRow[]>();
  if (rowError && isMissingSchemaError(rowError)) {
    ({ data: rowData, error: rowError } = await supabase
      .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
      .select(ROW_COLS)
      .in("itp_item_id", itemIds)
      .returns<AutomationRow[]>());
  }
  if (rowError) {
    console.error("[signoff-automation] could not read sign-off rows:", rowError.message);
    return NOTHING;
  }
  const rows: AutomationRow[] = rowData ?? [];
  if (rows.length === 0) return NOTHING;

  const [{ data: levelData }, { data: orgRow }] = await Promise.all([
    supabase
      .from(INTERVENTION_LEVEL_TYPES_TABLE)
      .select("code, label, sort_order, is_blocking, default_notice_hours")
      .eq("organization_id", organizationId)
      .returns<LevelInfo[]>(),
    supabase.from("organizations").select("itp_sequencing_mode").eq("id", organizationId).maybeSingle<{ itp_sequencing_mode: string }>(),
  ]);
  const levels = levelData ?? [];
  const strictMode = orgRow?.itp_sequencing_mode === "strict";
  const levelByCode = new Map(levels.map((l) => [l.code, l]));

  const result: AutomationResult = { notified: 0, proceeded: 0 };

  if (flags.autoProceed) {
    const { data: configs } = await supabase
      .from(NOTICE_PERIOD_CONFIGS_TABLE)
      .select("intervention, hours")
      .eq("project_id", itp.projectId)
      .returns<{ intervention: string; hours: number | null }[]>();
    const configHours = new Map((configs ?? []).map((c) => [c.intervention, c.hours]));

    const due = selectRowsToAutoProceed({
      itpStatus: itp.status,
      rows,
      levels,
      strictMode,
      now: new Date(),
      noticeHoursFor: (row) =>
        resolveNoticeHours({
          itemOverride: itemById.get(row.itp_item_id)?.notice_hours_override,
          projectConfigHours: configHours.get(row.intervention),
          levelDefaultHours: levelByCode.get(row.intervention)?.default_notice_hours,
          code: row.intervention,
        }),
    });

    for (const { row, noticeHours } of due) {
      const { data: updated, error } = await supabase
        .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
        .update({
          status: "proceeded_no_response",
          proceeded_reason: `Party notified ${row.notified_at}; no response within ${noticeHours}h notice period. Reason: Automatic - the organisation allows Witness/Surveillance to proceed after the notice period.`,
          proceeded_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "notified")
        .select("id");
      if (error) {
        console.error(`[signoff-automation] auto-proceed failed for progress ${row.id}:`, error.message);
        continue;
      }
      if (!updated || updated.length === 0) continue; // changed in the meantime (signed, withdrawn...)
      row.status = "proceeded_no_response"; // so the notify step below sees this level as cleared
      result.proceeded += 1;
      try {
        const label = levelByCode.get(row.intervention)?.label ?? row.intervention;
        await recordAuditEvent(supabase, {
          organizationId,
          projectId: itp.projectId,
          entityType: "signoff",
          entityId: row.id,
          action: "proceeded_no_response",
          actorId: null,
          summary: `Automatically proceeded without response (${label}, ${noticeHours}h notice elapsed) on ${itp.itpNumber} — ${itemById.get(row.itp_item_id)?.activity ?? "an activity"}`,
        });
      } catch {
        // Best-effort, as in proceedWithoutResponseAction.
      }
    }
  }

  if (flags.autoNotify) {
    const partyIds = [...new Set(rows.filter((r) => r.status === "pending").map((r) => r.project_party_id))];
    let inactive = new Set<string>();
    if (partyIds.length > 0) {
      const { data: parties } = await supabase
        .from("project_parties")
        .select("id, is_active")
        .in("id", partyIds)
        .returns<{ id: string; is_active: boolean }[]>();
      inactive = new Set((parties ?? []).filter((p) => p.is_active === false).map((p) => p.id));
    }
    const toNotify = selectRowsToAutoNotify({ itpStatus: itp.status, rows, levels, strictMode, inactivePartyIds: inactive });
    if (toNotify.length > 0) {
      const res = await notifyPendingRowsBulk(supabase, toNotify, { automatic: true });
      if (!res.error) result.notified = toNotify.length;
    }
  }

  return result;
}

/**
 * Periodic catch-up for every organisation that has either switch on: the time-based part (notice
 * periods running out) cannot be triggered by a click, so the cron route calls this. Safe to repeat.
 */
export async function runSignoffAutomationSweep(supabase: Client, opts: { maxItps?: number } = {}): Promise<AutomationResult & { itps: number }> {
  const total = { notified: 0, proceeded: 0, itps: 0 };
  const { data: orgs, error } = await supabase
    .from("organizations")
    .select("id")
    .or("auto_notify_signoffs.eq.true,auto_proceed_after_notice.eq.true");
  if (error) {
    if (!isMissingSchemaError(error)) console.error("[signoff-automation] sweep could not list organisations:", error.message);
    return total;
  }
  const orgIds = ((orgs ?? []) as { id: string }[]).map((o) => o.id);
  if (orgIds.length === 0) return total;

  const { data: itps } = await supabase
    .from("itps")
    .select("id, projects!inner(organization_id)")
    .in("status", ["approved", "client_accepted"])
    .in("projects.organization_id", orgIds)
    .limit(opts.maxItps ?? 1000)
    .returns<{ id: string }[]>();

  for (const itp of itps ?? []) {
    const r = await runSignoffAutomationForItp(itp.id, supabase);
    total.notified += r.notified;
    total.proceeded += r.proceeded;
    total.itps += 1;
  }
  return total;
}
