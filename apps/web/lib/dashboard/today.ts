import type { TodayItem } from "@/components/domain/today-queue";

/**
 * Turns each role's existing dashboard data into one urgency-ordered "Today" list. Pure functions —
 * no fetching — so the rules (what counts as urgent) are in one tested place, not spread across
 * three dashboards.
 */

const byUrgency = (a: TodayItem, b: TodayItem) => b.urgency - a.urgency;

function isPast(iso: string | null | undefined, now: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t < now;
}

// ---- Inspector ----------------------------------------------------------------------------

export interface InspectorTodayInput {
  pendingActions: { templateId: string; checklistNumber: string; activity: string; priority: "high" | "medium" | "low"; projectName: string; status: "not_started" | "in_progress" }[];
  pendingToday: { templateId: string }[];
  pendingOverdue: { templateId: string }[];
  overdueHoldPoints: number;
  oldestHoldPointDays: number;
  standaloneAssignments: { id: string; assignmentNumber: string; equipmentDescription: string; status: string; projectName: string }[];
}

export function buildInspectorToday(input: InspectorTodayInput): TodayItem[] {
  const overdue = new Set(input.pendingOverdue.map((a) => a.templateId));
  const today = new Set(input.pendingToday.map((a) => a.templateId));
  const items: TodayItem[] = [];

  if (input.overdueHoldPoints > 0) {
    items.push({
      id: "overdue-holds",
      kind: "hold",
      title: `${input.overdueHoldPoints} overdue hold point${input.overdueHoldPoints === 1 ? "" : "s"}`,
      meta: "Blocking sign-offs notified past their notice period",
      badge: `oldest ${input.oldestHoldPointDays}d`,
      urgency: 2,
      href: "/inspect/itps",
      actionLabel: "Review",
    });
  }

  for (const a of input.pendingActions) {
    const urgency: TodayItem["urgency"] = overdue.has(a.templateId) ? 2 : today.has(a.templateId) || a.priority === "high" ? 1 : 0;
    items.push({
      id: a.templateId,
      kind: "inspection",
      title: `${a.checklistNumber} — ${a.activity}`,
      meta: `${a.projectName} · ${a.status === "in_progress" ? "in progress" : "not started"}`,
      badge: overdue.has(a.templateId) ? "overdue" : a.priority === "high" ? "high priority" : undefined,
      urgency,
      href: `/inspect/checklists/${a.templateId}`,
      actionLabel: a.status === "in_progress" ? "Continue" : "Start",
    });
  }

  for (const s of input.standaloneAssignments) {
    items.push({
      id: s.id,
      kind: "assignment",
      title: `${s.assignmentNumber} — ${s.equipmentDescription}`,
      meta: s.projectName,
      urgency: 1,
      href: `/inspect/standalone/${s.id}`,
    });
  }

  return items.sort(byUrgency);
}

// ---- External parties (client / contractor / subcontractor / TPI) -------------------------

export interface ExternalTodayInput {
  acceptance: { id: string; itpNumber: string; title: string; projectName: string }[];
  review: { id: string; activity: string; itpId: string; itpNumber: string; intervention: string }[];
  signoffs: { id: string; activity: string; itpId: string; itpNumber: string; intervention: string; status: string; when: string | null }[];
  ncrs: { id: string; ncrNumber: string; severity: "observation" | "minor_ncr" | "major_ncr"; description: string; dueDate: string | null; projectName: string }[];
  now?: number;
}

export function buildExternalToday(input: ExternalTodayInput): TodayItem[] {
  const now = input.now ?? Date.now();
  const items: TodayItem[] = [];

  for (const a of input.acceptance) {
    items.push({
      id: a.id,
      kind: "acceptance",
      title: `${a.itpNumber} — ${a.title}`,
      meta: `${a.projectName} · your acceptance is the last step before field work`,
      urgency: 1,
      panel: `itp:${a.id}`,
      actionLabel: "Review & accept",
    });
  }
  for (const r of input.review) {
    items.push({
      id: r.id,
      kind: "review",
      title: `${r.itpNumber} — ${r.activity}`,
      meta: `Subcontractor has signed off · your ${r.intervention} review is next`,
      urgency: 1,
      href: `/inspect/itps/${r.itpId}`,
    });
  }
  for (const s of input.signoffs) {
    items.push({
      id: s.id,
      kind: "signoff",
      title: `${s.itpNumber} — ${s.activity}`,
      meta: `${s.intervention} point · ${s.status === "notified" ? "notified" : "pending"}${s.when ? ` ${s.when}` : ""}`,
      badge: s.status === "notified" ? "notified" : undefined,
      urgency: s.status === "notified" ? 2 : 1,
      href: `/inspect/itps/${s.itpId}`,
      actionLabel: "Sign off",
    });
  }
  for (const n of input.ncrs) {
    const late = isPast(n.dueDate, now);
    items.push({
      id: n.id,
      kind: "ncr",
      title: `${n.ncrNumber} — ${n.description}`,
      meta: n.projectName,
      badge: late ? "overdue" : n.dueDate ? `due ${n.dueDate}` : undefined,
      urgency: late ? 2 : n.severity === "observation" ? 0 : 1,
      href: `/inspect/ncrs/${n.id}`,
      actionLabel: "Close out",
    });
  }
  return items.sort(byUrgency);
}

// ---- JAGS Admin ---------------------------------------------------------------------------

export interface AdminTodayInput {
  ncrs: { id: string; ncrNumber: string; severity: "minor_ncr" | "major_ncr"; description: string; projectLabel: string; dueDate: string | null }[];
  proposals: { id: string; title: string }[];
  now?: number;
}

export function buildAdminToday(input: AdminTodayInput): TodayItem[] {
  const now = input.now ?? Date.now();
  const items: TodayItem[] = [];
  for (const n of input.ncrs) {
    const late = isPast(n.dueDate, now);
    items.push({
      id: n.id,
      kind: "ncr",
      title: `${n.ncrNumber} — ${n.description}`,
      meta: `${n.severity === "major_ncr" ? "Major" : "Minor"} · ${n.projectLabel}`,
      badge: late ? "overdue" : undefined,
      urgency: late || n.severity === "major_ncr" ? 2 : 1,
      panel: `ncr:${n.id}`,
      actionLabel: "Preview",
    });
  }
  for (const p of input.proposals) {
    items.push({
      id: p.id,
      kind: "proposal",
      title: p.title,
      meta: "Master Library proposal awaiting your decision",
      urgency: 1,
      panel: `proposal:${p.id}`,
      actionLabel: "Review",
    });
  }
  return items.sort(byUrgency);
}
