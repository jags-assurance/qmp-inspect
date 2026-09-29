import { supabase } from "./supabase";

// automation_rules/automation_notification_log/notifications aren't in the generated Database type
// (same documented escape hatch used throughout this worker for background_jobs — see index.ts).
// A plain `any`-typed handle is simplest here since every query shape below differs; the narrow,
// hand-written row interfaces below are what actually keep the rest of this file type-safe.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
const db = supabase as any;

interface AutomationRuleRow {
  id: string;
  organization_id: string;
  rule_type: "hold_elapsed" | "ncr_overdue" | "punch_overdue";
  enabled: boolean;
  threshold_hours: number;
  repeat_hours: number;
}

/** Has this exact (rule, entity) already been nudged within its own repeat window? Best-effort: a
 *  lookup failure just means "assume not sent" — a possible duplicate nudge is far better than the
 *  sweep silently going dark because one query hiccuped. */
async function alreadyNotifiedRecently(ruleId: string, entityId: string, repeatHours: number): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - repeatHours * 3600 * 1000).toISOString();
    const { data } = await db
      .from("automation_notification_log")
      .select("id")
      .eq("rule_id", ruleId)
      .eq("entity_id", entityId)
      .gte("sent_at", cutoff)
      .limit(1);
    return Boolean(data && data.length > 0);
  } catch {
    return false;
  }
}

async function recordSent(ruleId: string, entityId: string): Promise<void> {
  await db.from("automation_notification_log").insert({ rule_id: ruleId, entity_id: entityId });
}

/** Every JAGS admin login with access (global, or specifically to this org) — the fallback
 *  recipient for every rule type, since an admin can always act on a stuck item regardless of who
 *  else it's aimed at. */
async function getOrgAdminUserIds(organizationId: string): Promise<string[]> {
  const { data: grants } = await supabase
    .from("access_grants")
    .select("user_id, scope_type, organization_id")
    .or(`scope_type.eq.global,and(scope_type.eq.organization,organization_id.eq.${organizationId})`)
    .returns<{ user_id: string; scope_type: string; organization_id: string | null }[]>();

  const candidateIds = [...new Set((grants ?? []).map((g) => g.user_id))];
  if (candidateIds.length === 0) return [];

  const { data: admins } = await supabase
    .from("users")
    .select("id")
    .in("id", candidateIds)
    .eq("is_jags_staff", true)
    .eq("staff_role", "admin")
    .returns<{ id: string }[]>();

  return (admins ?? []).map((a) => a.id);
}

async function notify(organizationId: string, projectId: string | null, recipientUserId: string, title: string, body: string, link: string): Promise<void> {
  await supabase.from("notifications").insert({
    organization_id: organizationId,
    project_id: projectId,
    recipient_user_id: recipientUserId,
    title,
    body,
    link,
  });
}

interface HoldRow {
  id: string;
  itp_item_id: string;
  intervention: string;
  notified_at: string | null;
  itp_items: {
    activity: string;
    itp_sections: {
      itps: {
        itp_number: string;
        project_id: string;
        projects: { organization_id: string; name: string } | null;
      } | null;
    } | null;
  } | null;
}

async function sweepHoldElapsed(rule: AutomationRuleRow): Promise<number> {
  const { data: levels } = await supabase
    .from("intervention_level_types" as never)
    .select("code")
    .eq("organization_id", rule.organization_id)
    .eq("is_blocking", true)
    .returns<{ code: string }[]>();
  const blockingCodes = (levels ?? []).map((l) => l.code);
  if (blockingCodes.length === 0) return 0;

  const cutoff = new Date(Date.now() - rule.threshold_hours * 3600 * 1000).toISOString();
  const { data: rows } = await supabase
    .from("activity_signoff_progress" as never)
    .select(
      "id, itp_item_id, intervention, notified_at, itp_items(activity, itp_sections(itps(itp_number, project_id, projects(organization_id, name))))"
    )
    .eq("status", "notified")
    .in("intervention", blockingCodes)
    .lte("notified_at", cutoff)
    .returns<HoldRow[]>();

  let sent = 0;
  for (const row of rows ?? []) {
    const itp = row.itp_items?.itp_sections?.itps;
    const org = itp?.projects?.organization_id;
    if (!itp || org !== rule.organization_id) continue;
    if (await alreadyNotifiedRecently(rule.id, row.id, rule.repeat_hours)) continue;

    const admins = await getOrgAdminUserIds(rule.organization_id);
    const title = `Stuck Hold: ${itp.itp_number}`;
    const body = `${row.itp_items?.activity ?? "An activity"} has been waiting on a response for over ${rule.threshold_hours}h.`;
    const link = `/inspect/projects/${itp.project_id}`;
    for (const adminId of admins) {
      await notify(rule.organization_id, itp.project_id, adminId, title, body, link);
    }
    await recordSent(rule.id, row.id);
    sent += 1;
  }
  return sent;
}

interface NcrRow {
  id: string;
  ncr_number: string;
  project_id: string;
  due_date: string;
  assigned_to: string | null;
}

async function sweepNcrOverdue(rule: AutomationRuleRow): Promise<number> {
  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("organization_id", rule.organization_id)
    .returns<{ id: string }[]>();
  const projectIds = (projects ?? []).map((p) => p.id);
  if (projectIds.length === 0) return 0;

  const cutoffDate = new Date(Date.now() - rule.threshold_hours * 3600 * 1000).toISOString().slice(0, 10);
  const { data: ncrs } = await supabase
    .from("ncrs")
    .select("id, ncr_number, project_id, due_date, assigned_to")
    .in("project_id", projectIds)
    .neq("status", "closed")
    .not("due_date", "is", null)
    .lt("due_date", cutoffDate)
    .returns<NcrRow[]>();

  let sent = 0;
  const admins = await getOrgAdminUserIds(rule.organization_id);
  for (const ncr of ncrs ?? []) {
    if (await alreadyNotifiedRecently(rule.id, ncr.id, rule.repeat_hours)) continue;
    const recipients = new Set<string>(admins);
    if (ncr.assigned_to) recipients.add(ncr.assigned_to);
    const title = `Overdue NCR: ${ncr.ncr_number}`;
    const body = `Due ${ncr.due_date}, still open.`;
    const link = `/inspect/ncrs/${ncr.id}`;
    for (const userId of recipients) {
      await notify(rule.organization_id, ncr.project_id, userId, title, body, link);
    }
    await recordSent(rule.id, ncr.id);
    sent += 1;
  }
  return sent;
}

interface PunchRow {
  id: string;
  description: string;
  project_id: string;
  due_date: string;
  responsible_party_id: string | null;
  project_parties: { user_id: string | null } | null;
}

async function sweepPunchOverdue(rule: AutomationRuleRow): Promise<number> {
  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("organization_id", rule.organization_id)
    .returns<{ id: string }[]>();
  const projectIds = (projects ?? []).map((p) => p.id);
  if (projectIds.length === 0) return 0;

  const cutoffDate = new Date(Date.now() - rule.threshold_hours * 3600 * 1000).toISOString().slice(0, 10);
  const { data: rawItems } = await db
    .from("punch_list_items")
    .select("id, description, project_id, due_date, responsible_party_id, project_parties(user_id)")
    .in("project_id", projectIds)
    .neq("status", "closed")
    .not("due_date", "is", null)
    .lt("due_date", cutoffDate);
  const items = rawItems as PunchRow[] | null;

  let sent = 0;
  const admins = await getOrgAdminUserIds(rule.organization_id);
  for (const item of items ?? []) {
    if (await alreadyNotifiedRecently(rule.id, item.id, rule.repeat_hours)) continue;
    const recipients = new Set<string>(admins);
    if (item.project_parties?.user_id) recipients.add(item.project_parties.user_id);
    const title = "Overdue punch item";
    const body = `${item.description} — due ${item.due_date}, still open.`;
    const link = `/inspect/projects/${item.project_id}/punch-list`;
    for (const userId of recipients) {
      await notify(rule.organization_id, item.project_id, userId, title, body, link);
    }
    await recordSent(rule.id, item.id);
    sent += 1;
  }
  return sent;
}

/**
 * The one scheduled trigger in this whole app — everything else fires because a person clicked
 * something. Called periodically from index.ts's poll loop (not its own cron), evaluates every
 * enabled automation_rules row and turns a matching condition into a real notification. Best-effort
 * per rule: one rule's query failing never blocks the others.
 */
export async function runAutomationSweep(): Promise<void> {
  const { data, error } = await db.from("automation_rules").select("*").eq("enabled", true);
  const rules = data as AutomationRuleRow[] | null;

  if (error) {
    console.error("[worker] Failed to load automation_rules:", error.message);
    return;
  }
  if (!rules || rules.length === 0) return;

  let totalSent = 0;
  for (const rule of rules) {
    try {
      if (rule.rule_type === "hold_elapsed") totalSent += await sweepHoldElapsed(rule);
      else if (rule.rule_type === "ncr_overdue") totalSent += await sweepNcrOverdue(rule);
      else if (rule.rule_type === "punch_overdue") totalSent += await sweepPunchOverdue(rule);
    } catch (err) {
      console.error(`[worker] Automation rule ${rule.id} (${rule.rule_type}) failed:`, err instanceof Error ? err.message : err);
    }
  }
  if (totalSent > 0) {
    console.log(`[worker] Automation sweep sent ${totalSent} nudge(s).`);
  }
}
