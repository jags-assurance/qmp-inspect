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
  rule_type: "hold_elapsed" | "ncr_overdue" | "punch_overdue" | "register_expiry";
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

// ---- register_expiry -------------------------------------------------------------------------
// Alerts BEFORE a calibration / welder qualification / personnel certification lapses. Thresholds are
// fixed (warning window, 14, 7, expiry); threshold_hours/repeat_hours do not apply. Dedupe is per
// (item, expiry_date, threshold) in register_expiry_notifications, so a renewed certificate (new
// expiry date) starts a fresh cycle and re-running the sweep never double-sends.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysUntilDate(dateStr: string): number {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((new Date(`${dateStr.slice(0, 10)}T00:00:00Z`).getTime() - today) / MS_PER_DAY);
}

/** Tightest threshold already reached (e.g. 7 days left -> 7), or null if still outside the window. */
function reachedThreshold(days: number, windowDays: number): number | null {
  const thresholds = [0, 7, 14, windowDays].sort((a, b) => a - b);
  for (const t of thresholds) if (days <= t) return t;
  return null;
}

interface ExpiryItem {
  entityType: "calibration" | "welder" | "personnel";
  id: string;
  projectId: string;
  label: string;
  expiryDate: string;
  windowDays: number;
  extraRecipient: string | null;
}

async function sweepRegisterExpiry(organizationId: string): Promise<number> {
  const { data: projectRows } = await db
    .from("projects")
    .select("id, name, responsible_person_id")
    .eq("organization_id", organizationId);
  const projects = (projectRows ?? []) as { id: string; name: string; responsible_person_id: string | null }[];
  if (projects.length === 0) return 0;
  const projectIds = projects.map((p) => p.id);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const horizon = (days: number) => new Date(Date.now() + days * MS_PER_DAY).toISOString().slice(0, 10);
  const items: ExpiryItem[] = [];

  const { data: cals } = await db
    .from("calibration_register")
    .select("id, project_id, instrument_name, cert_number, due_date")
    .in("project_id", projectIds)
    .lte("due_date", horizon(30));
  for (const c of cals ?? []) {
    items.push({ entityType: "calibration", id: c.id, projectId: c.project_id, label: `Calibration ${c.instrument_name} (cert ${c.cert_number})`, expiryDate: c.due_date, windowDays: 30, extraRecipient: null });
  }

  const { data: welders } = await db
    .from("welder_qualification_register")
    .select("id, project_id, welder_identifier, wpq_number, expiry_date")
    .in("project_id", projectIds)
    .lte("expiry_date", horizon(90));
  for (const w of welders ?? []) {
    items.push({ entityType: "welder", id: w.id, projectId: w.project_id, label: `Welder qualification ${w.welder_identifier} (WPQ ${w.wpq_number ?? "n/a"})`, expiryDate: w.expiry_date, windowDays: 90, extraRecipient: null });
  }

  const { data: certs } = await db
    .from("personnel_certifications")
    .select("id, project_id, certification_type, cert_number, expiry_date, project_parties(name, user_id)")
    .in("project_id", projectIds)
    .lte("expiry_date", horizon(90));
  for (const c of certs ?? []) {
    items.push({
      entityType: "personnel",
      id: c.id,
      projectId: c.project_id,
      label: `Certification ${c.certification_type}${c.cert_number ? ` (${c.cert_number})` : ""}${c.project_parties?.name ? ` — ${c.project_parties.name}` : ""}`,
      expiryDate: c.expiry_date,
      windowDays: 90,
      extraRecipient: c.project_parties?.user_id ?? null,
    });
  }

  let sent = 0;
  let admins: string[] | null = null;
  for (const item of items) {
    const days = daysUntilDate(item.expiryDate);
    // Items that lapsed long ago are old news, not a fresh alert (avoids a flood on the first sweep).
    if (days < -30) continue;
    const threshold = reachedThreshold(days, item.windowDays);
    if (threshold === null) continue;

    // Claim the (item, expiry, threshold) slot first; the unique constraint makes concurrent/rerun sweeps idempotent.
    const { error: claimError } = await db.from("register_expiry_notifications").insert({
      organization_id: organizationId,
      entity_type: item.entityType,
      entity_id: item.id,
      expiry_date: item.expiryDate,
      threshold_days: threshold,
    });
    if (claimError) continue; // duplicate (already sent) or ledger unavailable — skip rather than spam

    const project = projectById.get(item.projectId);
    const recipients = new Set<string>();
    if (project?.responsible_person_id) recipients.add(project.responsible_person_id);
    if (item.extraRecipient) recipients.add(item.extraRecipient);
    if (recipients.size === 0) {
      admins ??= await getOrgAdminUserIds(organizationId);
      for (const a of admins) recipients.add(a);
    }

    const title = days < 0 ? `Expired: ${item.label}` : days === 0 ? `Expires today: ${item.label}` : `Expiring in ${days} day${days === 1 ? "" : "s"}: ${item.label}`;
    const body = `${project?.name ?? "Project"} — expiry date ${item.expiryDate}. Renew or replace it before it is used on further inspections.`;
    const link = `/inspect/projects/${item.projectId}/registers`;
    try {
      for (const userId of recipients) {
        await notify(organizationId, item.projectId, userId, title, body, link);
      }
      sent += 1;
    } catch (err) {
      // Release the claimed slot so the next sweep retries instead of silently losing the alert.
      await db
        .from("register_expiry_notifications")
        .delete()
        .eq("entity_type", item.entityType)
        .eq("entity_id", item.id)
        .eq("expiry_date", item.expiryDate)
        .eq("threshold_days", threshold);
      console.error("[automation] register_expiry notify failed; will retry next sweep:", err);
    }
  }
  return sent;
}

/** register_expiry is ON by default: every organisation is swept unless it has an explicit disabled row. */
async function runRegisterExpirySweep(): Promise<number> {
  const { data: orgs } = await db.from("organizations").select("id");
  const { data: disabled } = await db
    .from("automation_rules")
    .select("organization_id")
    .eq("rule_type", "register_expiry")
    .eq("enabled", false);
  const off = new Set(((disabled ?? []) as { organization_id: string }[]).map((r) => r.organization_id));
  let total = 0;
  for (const org of (orgs ?? []) as { id: string }[]) {
    if (off.has(org.id)) continue;
    try {
      total += await sweepRegisterExpiry(org.id);
    } catch (err) {
      console.error(`[worker] register_expiry sweep failed for org ${org.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return total;
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

  let totalSent = 0;
  try {
    totalSent += await runRegisterExpirySweep();
  } catch (err) {
    console.error("[worker] register_expiry sweep failed:", err instanceof Error ? err.message : err);
  }
  for (const rule of rules ?? []) {
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
