import { supabase } from "./supabase";
import { escalationTier, isDueSoon, siteDate } from "./escalation";
import { isMissingSchemaError, isReminderSuppressed, reminderStep, FINAL_REMINDER_STEP, type ReminderStep } from "./reminderPolicy";
import { firstNonEmptyLayer, reminderOutcome, type ReminderOutcome } from "./recipientPolicy";
import { daysWaiting, isAckReminderDue, isFinalAckReminder, MAX_ACK_REMINDERS } from "./handoverReminderPolicy";

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

/** Has this (rule, entity) already been nudged at this escalation step? Once per step, except the final
 *  step which repeats every repeat_hours (see reminderPolicy.ts). Best-effort: a lookup failure just means
 *  "assume not sent" — a possible duplicate nudge is far better than the sweep silently going dark because
 *  one query hiccuped. Before the tier column exists (migration 20261127000200) it falls back to the old
 *  time-window-only check. */
async function alreadyNotifiedAtStep(ruleId: string, entityId: string, step: ReminderStep, repeatHours: number): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("automation_notification_log")
      .select("sent_at")
      .eq("rule_id", ruleId)
      .eq("entity_id", entityId)
      .eq("tier", step)
      .order("sent_at", { ascending: false })
      .limit(1);
    if (error) {
      if (!isMissingSchemaError(error)) return false;
      const cutoff = new Date(Date.now() - repeatHours * 3600 * 1000).toISOString();
      const { data: recent } = await db
        .from("automation_notification_log")
        .select("id")
        .eq("rule_id", ruleId)
        .eq("entity_id", entityId)
        .gte("sent_at", cutoff)
        .limit(1);
      return Boolean(recent && recent.length > 0);
    }
    const last = (data as { sent_at: string }[] | null)?.[0]?.sent_at ?? null;
    return isReminderSuppressed(step, last, repeatHours);
  } catch {
    return false;
  }
}

async function recordSent(ruleId: string, entityId: string, step: ReminderStep): Promise<void> {
  const { error } = await db.from("automation_notification_log").insert({ rule_id: ruleId, entity_id: entityId, tier: step });
  if (error && isMissingSchemaError(error)) {
    await db.from("automation_notification_log").insert({ rule_id: ruleId, entity_id: entityId });
  }
}

/** Every JAGS admin login with access (global, or specifically to this org) — the fallback
 *  recipient for every rule type, since an admin can always act on a stuck item regardless of who
 *  else it's aimed at. */
export async function getOrgAdminUserIds(organizationId: string): Promise<string[]> {
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
    .eq("is_active", true)
    // The app treats a null staff_role (legacy accounts) as admin; so does this.
    .or("staff_role.eq.admin,staff_role.is.null")
    .returns<{ id: string }[]>();

  return (admins ?? []).map((a) => a.id);
}

/** Drops deactivated users from a recipient set: nobody should be nudged on an account that is switched off. */
async function onlyActiveUsers(ids: Iterable<string>): Promise<string[]> {
  const list = [...new Set(ids)];
  if (list.length === 0) return [];
  try {
    const { data } = await db.from("users").select("id").in("id", list).eq("is_active", true);
    return ((data ?? []) as { id: string }[]).map((u) => u.id);
  } catch {
    return list;
  }
}

/** Writes one in-app notification. Returns true only when the row was really inserted; a refused insert is logged and returns false. */
export async function notify(organizationId: string, projectId: string | null, recipientUserId: string, title: string, body: string, link: string): Promise<boolean> {
  const { error } = await supabase.from("notifications").insert({
    organization_id: organizationId,
    project_id: projectId,
    recipient_user_id: recipientUserId,
    title,
    body,
    link,
  });
  if (error) {
    console.error(`[automation] notification insert failed for ${recipientUserId}: ${error.message}`);
    return false;
  }
  return true;
}

/** Every login behind the given project parties: the primary login plus party members (project_party_members). */
export async function getPartyUserIds(partyIds: Array<string | null | undefined>): Promise<string[]> {
  const ids = [...new Set(partyIds.filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return [];
  const out = new Set<string>();
  try {
    const { data: parties } = await db.from("project_parties").select("user_id").in("id", ids);
    for (const p of (parties ?? []) as { user_id: string | null }[]) if (p.user_id) out.add(p.user_id);
    const { data: members } = await db.from("project_party_members").select("user_id").in("project_party_id", ids).not("user_id", "is", null);
    for (const m of (members ?? []) as { user_id: string | null }[]) if (m.user_id) out.add(m.user_id);
  } catch {
    // best-effort: fall through with whatever was read
  }
  return [...out];
}

/** Team leads (and other members) of the teams assigned to a project. */
async function getProjectTeamUserIds(projectId: string): Promise<{ leads: string[]; members: string[] }> {
  try {
    const { data: assigns } = await db.from("team_project_assignments").select("team_id").eq("project_id", projectId);
    const teamIds = ((assigns ?? []) as { team_id: string }[]).map((a) => a.team_id);
    if (teamIds.length === 0) return { leads: [], members: [] };
    const { data: rows } = await db.from("team_members").select("user_id, is_team_lead").in("team_id", teamIds);
    const all = (rows ?? []) as { user_id: string; is_team_lead: boolean }[];
    return { leads: all.filter((r) => r.is_team_lead).map((r) => r.user_id), members: all.filter((r) => !r.is_team_lead).map((r) => r.user_id) };
  } catch {
    return { leads: [], members: [] };
  }
}

/**
 * Last-resort recipients when an item has nobody directly responsible: the party's logins and members,
 * then the project's team lead, then the project's JAGS team members and organisation admins. The first
 * layer that still has an active user wins. Returns [] only when truly nobody exists.
 */
export async function resolveFallbackRecipients(organizationId: string, projectId: string, partyId: string | null | undefined): Promise<string[]> {
  const team = await getProjectTeamUserIds(projectId);
  const layers: Array<() => Promise<string[]>> = [
    () => getPartyUserIds([partyId]),
    async () => team.leads,
    async () => [...team.members, ...(await getOrgAdminUserIds(organizationId))],
  ];
  for (const layer of layers) {
    const active = firstNonEmptyLayer([await onlyActiveUsers(await layer())]);
    if (active.length > 0) return active;
  }
  return [];
}

/**
 * Notifies the active members of `recipients`, falling back (see resolveFallbackRecipients) when there are
 * none. 'sent' only if at least one notification row was really written; otherwise 'no_recipient' (with a
 * warning) or 'failed', and the caller must NOT record the reminder step as sent.
 */
async function deliverReminder(
  organizationId: string,
  projectId: string,
  partyId: string | null | undefined,
  recipients: Iterable<string>,
  message: { title: string; body: string; link: string },
  label: string
): Promise<ReminderOutcome> {
  let targets = await onlyActiveUsers(recipients);
  if (targets.length === 0) targets = await resolveFallbackRecipients(organizationId, projectId, partyId);
  let delivered = 0;
  for (const userId of targets) {
    if (await notify(organizationId, projectId, userId, message.title, message.body, message.link)) delivered += 1;
  }
  const outcome = reminderOutcome(targets.length, delivered);
  if (outcome === "no_recipient") console.warn(`[automation] ${label}: no recipient could be found (project ${projectId}); reminder not recorded as sent, will retry next sweep.`);
  else if (outcome === "failed") console.error(`[automation] ${label}: every notification insert failed; reminder not recorded as sent, will retry next sweep.`);
  return outcome;
}

interface HoldRow {
  id: string;
  itp_item_id: string;
  intervention: string;
  notified_at: string | null;
  project_party_id: string;
  project_parties: { user_id: string | null } | null;
  itp_items: {
    activity: string;
    itp_sections: {
      itps: {
        id: string;
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
      "id, itp_item_id, intervention, notified_at, project_party_id, project_parties(user_id), itp_items(activity, itp_sections(itps(id, itp_number, project_id, projects(organization_id, name))))"
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
    // A Hold has no ladder: its single step is the final one, so it repeats every repeat_hours.
    if (await alreadyNotifiedAtStep(rule.id, row.id, FINAL_REMINDER_STEP, rule.repeat_hours)) continue;

    const admins = await getOrgAdminUserIds(rule.organization_id);
    const title = `Stuck Hold: ${itp.itp_number}`;
    const body = `${row.itp_items?.activity ?? "An activity"} has been waiting on a response for over ${rule.threshold_hours}h.`;
    const link = `/inspect/itps/${itp.id}`;
    // Escalation: the party who owes the sign-off is nudged too, not only org admins.
    const recipients = new Set<string>(admins);
    if (row.project_parties?.user_id) recipients.add(row.project_parties.user_id);
    for (const memberId of await getPartyUserIds([row.project_party_id])) recipients.add(memberId);
    const outcome = await deliverReminder(rule.organization_id, itp.project_id, row.project_party_id, recipients, { title, body, link }, `hold_elapsed ${row.id}`);
    if (outcome !== "sent") continue;
    await recordSent(rule.id, row.id, FINAL_REMINDER_STEP);
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
  raised_by: string | null;
  status: string;
  responsible_party_id: string | null;
  project_parties: { user_id: string | null } | null;
}

/** Users holding the custom-role close_ncr permission on a project (project-scoped or org/platform-wide). Best-effort. */
async function getCloseNcrHolderIds(projectId: string): Promise<string[]> {
  try {
    const { data: perms } = await supabase
      .from("custom_role_permissions" as never)
      .select("role_id")
      .eq("permission_key", "close_ncr")
      .returns<{ role_id: string }[]>();
    const roleIds = (perms ?? []).map((p) => p.role_id);
    if (roleIds.length === 0) return [];
    const { data: assigns } = await supabase
      .from("custom_role_assignments" as never)
      .select("user_id, project_id")
      .in("role_id", roleIds)
      .returns<{ user_id: string; project_id: string | null }[]>();
    return (assigns ?? []).filter((a) => a.project_id === null || a.project_id === projectId).map((a) => a.user_id);
  } catch {
    return [];
  }
}

async function sweepNcrOverdue(rule: AutomationRuleRow): Promise<number> {
  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("organization_id", rule.organization_id)
    .returns<{ id: string }[]>();
  const projectIds = (projects ?? []).map((p) => p.id);
  if (projectIds.length === 0) return 0;

  const today = siteDate();
  const soonDate = siteDate(new Date(Date.now() + 2 * 86_400_000));
  const cutoffDate = siteDate(new Date(Date.now() - rule.threshold_hours * 3600 * 1000));
  // Overdue beyond the rule's threshold, plus items due within the next two days (pre-due reminder).
  const { data: ncrs } = await supabase
    .from("ncrs")
    .select("id, ncr_number, project_id, due_date, assigned_to, raised_by, status, responsible_party_id, project_parties(user_id)")
    .in("project_id", projectIds)
    .neq("status", "closed")
    .not("due_date", "is", null)
    .or(`due_date.lt.${cutoffDate},and(due_date.gte.${today},due_date.lte.${soonDate})`)
    .returns<NcrRow[]>();

  let sent = 0;
  const admins = await getOrgAdminUserIds(rule.organization_id);
  for (const ncr of ncrs ?? []) {
    if (!ncr.due_date) continue;
    const dueSoon = isDueSoon(ncr.due_date, today);
    const tier = escalationTier(ncr.due_date, today);
    if (!dueSoon && tier === 0) continue;
    const step = reminderStep(dueSoon, tier);
    if (await alreadyNotifiedAtStep(rule.id, ncr.id, step, rule.repeat_hours)) continue;
    const recipients = new Set<string>();
    const awaitingVerification = ncr.status === "pending_verification";
    // Tier 1 / due soon: the people doing the work. Pending verification: the work is done, so the
    // verifiers (close holders) and the raiser, not the assignee.
    if (ncr.raised_by) recipients.add(ncr.raised_by);
    if (awaitingVerification) {
      for (const holder of await getCloseNcrHolderIds(ncr.project_id)) recipients.add(holder);
      for (const admin of admins) recipients.add(admin);
    } else {
      if (ncr.assigned_to) recipients.add(ncr.assigned_to);
      for (const id of await getPartyUserIds([ncr.responsible_party_id])) recipients.add(id);
      // Tier 2: those who verify/close; tier 3: organisation admins.
      if (tier >= 2) for (const holder of await getCloseNcrHolderIds(ncr.project_id)) recipients.add(holder);
      if (tier >= 3) for (const admin of admins) recipients.add(admin);
    }
    const title = dueSoon
      ? `NCR due soon: ${ncr.ncr_number}`
      : awaitingVerification
        ? `NCR overdue for verification: ${ncr.ncr_number}`
        : `Overdue NCR: ${ncr.ncr_number}${tier >= 3 ? " (escalated)" : ""}`;
    const body = dueSoon
      ? `Due ${ncr.due_date}.`
      : awaitingVerification
        ? `Due ${ncr.due_date}, awaiting verification.`
        : `Due ${ncr.due_date}, still open.`;
    const link = `/inspect/ncrs/${ncr.id}`;
    const outcome = await deliverReminder(rule.organization_id, ncr.project_id, ncr.responsible_party_id, recipients, { title, body, link }, `ncr_overdue ${ncr.ncr_number}`);
    if (outcome !== "sent") continue;
    await recordSent(rule.id, ncr.id, step);
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
  status: string;
  created_by: string | null;
  project_parties: { user_id: string | null } | null;
}

/** Users holding close_punch_item for a project (project-scoped or org/platform-wide assignment). */
async function getPunchVerifierUserIds(projectId: string): Promise<string[]> {
  try {
    const { data: perms } = await db.from("custom_role_permissions").select("role_id").eq("permission_key", "close_punch_item");
    const roleIds = [...new Set(((perms ?? []) as { role_id: string }[]).map((p) => p.role_id))];
    if (roleIds.length === 0) return [];
    const { data: assigns } = await db.from("custom_role_assignments").select("user_id, project_id").in("role_id", roleIds);
    return [
      ...new Set(
        ((assigns ?? []) as { user_id: string; project_id: string | null }[])
          .filter((a) => a.project_id === null || a.project_id === projectId)
          .map((a) => a.user_id)
      ),
    ];
  } catch {
    return [];
  }
}

async function sweepPunchOverdue(rule: AutomationRuleRow): Promise<number> {
  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("organization_id", rule.organization_id)
    .returns<{ id: string }[]>();
  const projectIds = (projects ?? []).map((p) => p.id);
  if (projectIds.length === 0) return 0;

  const today = siteDate();
  const soonDate = siteDate(new Date(Date.now() + 2 * 86_400_000));
  const cutoffDate = siteDate(new Date(Date.now() - rule.threshold_hours * 3600 * 1000));
  const { data: rawItems } = await db
    .from("punch_list_items")
    .select("id, description, project_id, due_date, responsible_party_id, status, created_by, project_parties(user_id)")
    .in("project_id", projectIds)
    .neq("status", "closed")
    .not("due_date", "is", null)
    .or(`due_date.lt.${cutoffDate},and(due_date.gte.${today},due_date.lte.${soonDate})`);
  const items = rawItems as PunchRow[] | null;

  let sent = 0;
  const admins = await getOrgAdminUserIds(rule.organization_id);
  for (const item of items ?? []) {
    const dueSoon = isDueSoon(item.due_date, today);
    const tier = escalationTier(item.due_date, today);
    if (!dueSoon && tier === 0) continue;
    const step = reminderStep(dueSoon, tier);
    if (await alreadyNotifiedAtStep(rule.id, item.id, step, rule.repeat_hours)) continue;
    const recipients = new Set<string>();
    const partyUsers = await getPartyUserIds([item.responsible_party_id]);
    let body: string;
    if (item.status === "resolved") {
      // Fixed but unverified: the ball is with the verifiers, not the resolver's party.
      for (const id of await getPunchVerifierUserIds(item.project_id)) recipients.add(id);
      if (tier >= 3 || recipients.size === 0) for (const admin of admins) recipients.add(admin);
      if (recipients.size === 0 && item.created_by) recipients.add(item.created_by);
      body = dueSoon
        ? `${item.description} — due ${item.due_date}, awaiting verification.`
        : `${item.description} — due ${item.due_date}, resolved but still awaiting verification.`;
    } else {
      for (const id of partyUsers) recipients.add(id);
      if (partyUsers.length === 0 && item.created_by) recipients.add(item.created_by); // party has no login
      if (tier >= 2) for (const id of await getPunchVerifierUserIds(item.project_id)) recipients.add(id);
      if (tier >= 3) for (const admin of admins) recipients.add(admin);
      body = dueSoon ? `${item.description} — due ${item.due_date}.` : `${item.description} — due ${item.due_date}, still open.`;
    }
    const title = dueSoon ? "Punch item due soon" : tier >= 3 ? "Overdue punch item (escalated)" : "Overdue punch item";
    const link = `/inspect/projects/${item.project_id}/punch-list?item=${item.id}`;
    const outcome = await deliverReminder(rule.organization_id, item.project_id, item.responsible_party_id, recipients, { title, body, link }, `punch_overdue ${item.id}`);
    if (outcome !== "sent") continue;
    await recordSent(rule.id, item.id, step);
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
  // Negative thresholds are overdue reminders (7 and 14 days after expiry), so a lapse isn't announced once and forgotten.
  const thresholds = [-14, -7, 0, 7, 14, windowDays].sort((a, b) => a - b);
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
    .eq("organization_id", organizationId)
    // Finished, cancelled and not-yet-started jobs don't need renewal alerts.
    .in("status", ["active", "on_hold"]);
  const projects = (projectRows ?? []) as { id: string; name: string; responsible_person_id: string | null }[];
  if (projects.length === 0) return 0;
  const projectIds = projects.map((p) => p.id);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const horizon = (days: number) => new Date(Date.now() + days * MS_PER_DAY).toISOString().slice(0, 10);
  const items: ExpiryItem[] = [];

  // Superseded / retired / withdrawn rows are skipped; before the lifecycle migration the filter is simply omitted.
  const activeRows = async (table: string, columns: string, dateColumn: string, days: number) => {
    const run = (activeOnly: boolean) => {
      let q = db.from(table).select(columns).in("project_id", projectIds).lte(dateColumn, horizon(days));
      if (activeOnly) q = q.eq("lifecycle_status", "active");
      return q;
    };
    const first = await run(true);
    if (!first.error) return first.data as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const fallback = await run(false);
    return (fallback.data ?? []) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const cals = await activeRows("calibration_register", "id, project_id, instrument_name, cert_number, due_date", "due_date", 30);
  for (const c of cals ?? []) {
    items.push({ entityType: "calibration", id: c.id, projectId: c.project_id, label: `Calibration ${c.instrument_name} (cert ${c.cert_number})`, expiryDate: c.due_date, windowDays: 30, extraRecipient: null });
  }

  const welders = await activeRows("welder_qualification_register", "id, project_id, welder_identifier, wpq_number, expiry_date", "expiry_date", 90);
  for (const w of welders ?? []) {
    items.push({ entityType: "welder", id: w.id, projectId: w.project_id, label: `Welder qualification ${w.welder_identifier} (WPQ ${w.wpq_number ?? "n/a"})`, expiryDate: w.expiry_date, windowDays: 90, extraRecipient: null });
  }

  const certs = await activeRows(
    "personnel_certifications",
    "id, project_id, certification_type, cert_number, expiry_date, project_parties(name, user_id)",
    "expiry_date",
    90
  );
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

  const performingPartyUsers = new Map<string, string[]>();
  if (items.length > 0) {
    const { data: parties } = await db
      .from("project_parties")
      .select("id, project_id, user_id")
      .in("project_id", projectIds)
      .eq("is_active", true)
      .in("party_type", ["main_contractor", "subcontractor", "tpi_lab"]);
    const partyRows = (parties ?? []) as { id: string; project_id: string; user_id: string | null }[];
    for (const p of partyRows) {
      // Primary login plus every party member, not only the primary login.
      const users = [...(p.user_id ? [p.user_id] : []), ...(await getPartyUserIds([p.id]))];
      performingPartyUsers.set(p.project_id, [...(performingPartyUsers.get(p.project_id) ?? []), ...users]);
    }
  }

  let sent = 0;
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
    // The parties that must renew calibration / welder records (contractor, subcontractor, TPI/lab).
    for (const u of performingPartyUsers.get(item.projectId) ?? []) recipients.add(u);
    let targets = await onlyActiveUsers(recipients);
    if (targets.length === 0) targets = await resolveFallbackRecipients(organizationId, item.projectId, null);

    const title = days < 0 ? `Expired: ${item.label}` : days === 0 ? `Expires today: ${item.label}` : `Expiring in ${days} day${days === 1 ? "" : "s"}: ${item.label}`;
    const body = `${project?.name ?? "Project"} — expiry date ${item.expiryDate}. Renew or replace it before it is used on further inspections.`;
    const link = `/inspect/projects/${item.projectId}/registers`;
    try {
      // One recipient failing must not stop (or, on retry, repeat) the others: collect failures, and only
      // release the claim when nobody could be notified.
      let delivered = 0;
      let lastErr: unknown = null;
      for (const userId of targets) {
        try {
          if (await notify(organizationId, item.projectId, userId, title, body, link)) delivered += 1;
          else lastErr = new Error("notification insert refused");
        } catch (err) {
          lastErr = err;
        }
      }
      const outcome = reminderOutcome(targets.length, delivered);
      if (outcome === "no_recipient") throw new Error(`no recipient could be found for project ${item.projectId}`);
      if (outcome === "failed") throw lastErr ?? new Error("all notification inserts failed");
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

interface AckReminderRow {
  id: string;
  certificate_number: string;
  issued_date: string;
  issued_by: string | null;
  package_storage_path: string | null;
  ack_reminder_count: number | null;
  last_ack_reminder_at: string | null;
  data_books: {
    project_id: string;
    book_number: string;
    projects: { organization_id: string; name: string } | null;
  } | null;
}

/**
 * S7-18: remind the client to acknowledge an issued handover certificate (first nudge after 3 days, then
 * weekly, at most MAX_ACK_REMINDERS; the issuer is told on the final one). Always on, like register_expiry.
 * Needs the ack_reminder_* columns (20261108000102); until that migration is applied the query errors and
 * the sweep quietly does nothing. The counter is advanced only after the notifications were written, so a
 * failed insert is retried on the next sweep instead of being lost.
 */
async function sweepHandoverAckReminders(): Promise<number> {
  const { data, error } = await db
    .from("handover_certificates")
    .select(
      "id, certificate_number, issued_date, issued_by, package_storage_path, ack_reminder_count, last_ack_reminder_at, data_books(project_id, book_number, projects(organization_id, name))"
    )
    .is("acknowledged_at", null)
    .is("rejected_at", null)
    .is("superseded_at", null)
    .not("package_storage_path", "is", null)
    .limit(200);
  if (error) {
    // Columns not there yet (migration pending) or a transient failure: nothing to chase.
    return 0;
  }
  const now = Date.now();
  let sent = 0;
  for (const cert of (data ?? []) as AckReminderRow[]) {
    const count = cert.ack_reminder_count ?? 0;
    const due = isAckReminderDue(
      { issuedAt: cert.issued_date, reminderCount: count, lastReminderAt: cert.last_ack_reminder_at, hasPackage: Boolean(cert.package_storage_path) },
      now
    );
    if (!due) continue;
    const project = cert.data_books?.projects;
    const projectId = cert.data_books?.project_id;
    if (!project || !projectId) continue;
    try {
      const { data: grants } = await supabase
        .from("access_grants")
        .select("user_id, scope_type, organization_id, project_id")
        .eq("role", "client")
        .or(`and(scope_type.eq.organization,organization_id.eq.${project.organization_id}),and(scope_type.eq.project,project_id.eq.${projectId})`)
        .returns<{ user_id: string }[]>();
      const clientIds = await onlyActiveUsers((grants ?? []).map((g) => g.user_id));
      const days = daysWaiting(cert.issued_date, now);
      const final = isFinalAckReminder(count);
      const title = `Reminder: acknowledge handover certificate ${cert.certificate_number}`;
      const body = `Data Book ${cert.data_books?.book_number ?? ""} for ${project.name} was issued ${days} day(s) ago and is still awaiting your acknowledgement. Please review it and acknowledge receipt, or reject it with a reason.`;
      for (const id of clientIds) await notify(project.organization_id, projectId, id, title, body, "/inspect/handover");
      if (final && cert.issued_by) {
        const [issuer] = await onlyActiveUsers([cert.issued_by]);
        if (issuer) {
          await notify(
            project.organization_id,
            projectId,
            issuer,
            `Handover certificate ${cert.certificate_number} still not acknowledged`,
            `The client has now been reminded ${MAX_ACK_REMINDERS} times over ${days} days without a response. Follow up with them directly.`,
            `/inspect/projects/${projectId}/data-book`
          );
        }
      }
      const { error: updError } = await db
        .from("handover_certificates")
        .update({ ack_reminder_count: count + 1, last_ack_reminder_at: new Date(now).toISOString() })
        .eq("id", cert.id)
        .is("acknowledged_at", null);
      if (updError) console.error(`[automation] could not record handover reminder for ${cert.id}:`, updError.message);
      sent += clientIds.length;
    } catch (err) {
      console.error(`[automation] handover acknowledgement reminder failed for ${cert.id}; will retry next sweep:`, err);
    }
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

  let totalSent = 0;
  try {
    totalSent += await runRegisterExpirySweep();
  } catch (err) {
    console.error("[worker] register_expiry sweep failed:", err instanceof Error ? err.message : err);
  }
  try {
    totalSent += await sweepHandoverAckReminders();
  } catch (err) {
    console.error("[worker] handover acknowledgement reminder sweep failed:", err instanceof Error ? err.message : err);
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
