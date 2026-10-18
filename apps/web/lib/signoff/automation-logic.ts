import { resolveUnclearedLowerLevel } from "./sequencing";
import { DEFAULT_NOTICE_PERIOD_HOURS, type SignoffStatus } from "./db-types";
import type { InterventionLevelTypeRow } from "@/lib/intervention-levels/types";

/**
 * Pure decision logic for the phase-2 sign-off automation (no I/O, unit-tested in
 * __tests__/automation-logic.test.ts). The I/O side lives in ./automation.ts.
 *
 * Hard rules encoded here:
 *  - Only a PENDING row is ever auto-notified, and only when no lower level still has to clear
 *    (same resolveUnclearedLowerLevel the manual sign-off gate uses).
 *  - Only a NOTIFIED Witness (W) or Surveillance (S) row, whose level is non-blocking, may auto-proceed
 *    once its notice period has elapsed. A Hold (H) or Review (R) never does, whatever the org has
 *    configured, and nothing here ever produces a 'signed_off'.
 */

export interface AutomationFlags {
  autoNotify: boolean;
  autoProceed: boolean;
}

export const AUTOMATION_OFF: AutomationFlags = { autoNotify: false, autoProceed: false };

/** Anything other than a literal `true` is off, so a missing column / null / error all mean "off". */
export function parseAutomationFlags(
  row: { auto_notify_signoffs?: unknown; auto_proceed_after_notice?: unknown } | null | undefined
): AutomationFlags {
  return {
    autoNotify: row?.auto_notify_signoffs === true,
    autoProceed: row?.auto_proceed_after_notice === true,
  };
}

/** Level codes that may ever proceed without a response automatically. Hold and Review are deliberately absent. */
export const AUTO_PROCEED_LEVEL_CODES: readonly string[] = ["W", "S"];

export type LevelInfo = Pick<InterventionLevelTypeRow, "code" | "label" | "sort_order" | "is_blocking"> &
  Partial<Pick<InterventionLevelTypeRow, "default_notice_hours">>;

export function canAutoProceedLevel(code: string, level: Pick<LevelInfo, "is_blocking"> | undefined): boolean {
  if (!AUTO_PROCEED_LEVEL_CODES.includes(code)) return false;
  // The org's own configuration must also say non-blocking (a Witness reconfigured as blocking is a hold).
  return !!level && level.is_blocking === false;
}

export interface AutomationRow {
  id: string;
  itp_item_id: string;
  project_party_id: string;
  intervention: string;
  status: SignoffStatus;
  notified_at: string | null;
  /** Set when the party returned the release request; null/undefined otherwise. */
  rejected_at?: string | null;
}

export function isItpOpenForSignoff(status: string | null | undefined): boolean {
  return status === "approved" || status === "client_accepted";
}

function rowsByItem(rows: AutomationRow[]): Map<string, AutomationRow[]> {
  const map = new Map<string, AutomationRow[]>();
  for (const r of rows) {
    const list = map.get(r.itp_item_id);
    if (list) list.push(r);
    else map.set(r.itp_item_id, [r]);
  }
  return map;
}

/** Pending rows that should be notified now. */
export function selectRowsToAutoNotify(input: {
  itpStatus: string | null | undefined;
  rows: AutomationRow[];
  levels: LevelInfo[];
  strictMode: boolean;
  /** Parties that are deactivated: never notified automatically. */
  inactivePartyIds?: ReadonlySet<string>;
}): AutomationRow[] {
  if (!isItpOpenForSignoff(input.itpStatus)) return [];
  const out: AutomationRow[] = [];
  for (const itemRows of rowsByItem(input.rows).values()) {
    for (const row of itemRows) {
      if (row.status !== "pending") continue;
      // A returned (rejected) release is a human conversation; never re-sent automatically.
      if (row.rejected_at) continue;
      if (input.inactivePartyIds?.has(row.project_party_id)) continue;
      if (resolveUnclearedLowerLevel(input.levels, row.intervention, input.strictMode, itemRows) !== null) continue;
      out.push(row);
    }
  }
  return out;
}

/** Same precedence as getNoticePeriodHours in ./actions.ts: item override, project config, org level default, built-in. */
export function resolveNoticeHours(input: {
  itemOverride: number | null | undefined;
  projectConfigHours: number | null | undefined;
  levelDefaultHours: number | null | undefined;
  code: string;
}): number {
  return input.itemOverride ?? input.projectConfigHours ?? input.levelDefaultHours ?? DEFAULT_NOTICE_PERIOD_HOURS[input.code] ?? 24;
}

export function isNoticePeriodElapsed(notifiedAt: string | null, noticeHours: number, now: Date): boolean {
  if (!notifiedAt) return false;
  const start = new Date(notifiedAt).getTime();
  if (!Number.isFinite(start)) return false;
  return now.getTime() >= start + noticeHours * 3_600_000;
}

/** Notified W/S rows whose notice period has run out with no response. Never a Hold or Review. */
export function selectRowsToAutoProceed(input: {
  itpStatus: string | null | undefined;
  rows: AutomationRow[];
  levels: LevelInfo[];
  strictMode: boolean;
  noticeHoursFor: (row: AutomationRow) => number;
  now: Date;
}): { row: AutomationRow; noticeHours: number }[] {
  if (!isItpOpenForSignoff(input.itpStatus)) return [];
  const levelByCode = new Map(input.levels.map((l) => [l.code, l]));
  const out: { row: AutomationRow; noticeHours: number }[] = [];
  for (const itemRows of rowsByItem(input.rows).values()) {
    for (const row of itemRows) {
      if (row.status !== "notified") continue;
      if (!canAutoProceedLevel(row.intervention, levelByCode.get(row.intervention))) continue;
      const noticeHours = input.noticeHoursFor(row);
      if (!isNoticePeriodElapsed(row.notified_at, noticeHours, input.now)) continue;
      if (resolveUnclearedLowerLevel(input.levels, row.intervention, input.strictMode, itemRows) !== null) continue;
      out.push({ row, noticeHours });
    }
  }
  return out;
}
