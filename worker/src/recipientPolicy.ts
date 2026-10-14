// Pure recipient / outcome policy for automated reminders (no I/O, unit-tested).

/** Result of trying to notify a set of recipients. */
export type ReminderOutcome = "sent" | "no_recipient" | "failed";

/**
 * The first non-empty layer wins (layers are ordered most specific to least specific); ids are
 * de-duplicated. Returns [] only when every layer is empty, which the caller must treat as
 * 'no_recipient' - never as 'sent'.
 */
export function firstNonEmptyLayer(layers: Array<Iterable<string | null | undefined>>): string[] {
  for (const layer of layers) {
    const ids = [...new Set([...layer].filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (ids.length > 0) return ids;
  }
  return [];
}

/** Whether a reminder step may be recorded as sent: only when at least one notification was really written. */
export function reminderOutcome(recipientCount: number, deliveredCount: number): ReminderOutcome {
  if (recipientCount === 0) return "no_recipient";
  return deliveredCount > 0 ? "sent" : "failed";
}
