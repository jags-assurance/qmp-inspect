// Pure dedupe policy for overdue reminders (no I/O, unit-tested).
//
// A reminder is sent ONCE per escalation step: the due-soon nudge (step 0) and each overdue tier
// (1, 2, 3) each fire a single time, so a tier change notifies straight away and a still-overdue
// item is not re-nudged every repeat window while it sits in the same tier. Only the FINAL tier
// (3, organisation admins) repeats, every `repeat_hours`, because nobody is left to escalate to.
// Rules with no ladder (stuck Holds) have a single, final step.

import type { EscalationTier } from "./escalation";

export type ReminderStep = 0 | 1 | 2 | 3;

export const FINAL_REMINDER_STEP: ReminderStep = 3;

/** The ladder step an item is on: 0 = due soon, otherwise its overdue tier (1..3). */
export function reminderStep(dueSoon: boolean, tier: EscalationTier): ReminderStep {
  return dueSoon ? 0 : (tier as ReminderStep);
}

/**
 * Should the reminder for `step` be skipped? `lastSentAtForStep` is the most recent time a reminder
 * for THIS step was sent for this (rule, entity), or null when none was. Non-final steps are
 * skipped for good once sent; the final step is skipped only inside the repeat window.
 */
export function isReminderSuppressed(
  step: ReminderStep,
  lastSentAtForStep: string | null,
  repeatHours: number,
  now: number = Date.now()
): boolean {
  if (!lastSentAtForStep) return false;
  if (step !== FINAL_REMINDER_STEP) return true;
  const sent = Date.parse(lastSentAtForStep);
  if (!Number.isFinite(sent)) return false;
  return now - sent < repeatHours * 3_600_000;
}

/** A PostgREST / Postgres "column or table does not exist (yet)" error: the migration is not applied. */
export function isMissingSchemaError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (["42703", "42P01", "PGRST204", "PGRST205"].includes(code)) return true;
  return /could not find the .* column|schema cache|column .* does not exist/i.test(error.message ?? "");
}
