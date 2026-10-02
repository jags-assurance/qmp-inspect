// Plain (non-"use client") module on purpose: server pages call parseDateRange/dateRangeToFromIso, and a
// function exported from a "use client" file can't be called from a Server Component (Next turns it
// into a client reference), which crashed the Activity and Audit Log pages for every role.

export const DATE_RANGE_OPTIONS = ["7d", "30d", "90d", "all"] as const;
export type DateRangeOption = (typeof DATE_RANGE_OPTIONS)[number];

export const DATE_RANGE_LABELS: Record<DateRangeOption, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

export const DEFAULT_DATE_RANGE: DateRangeOption = "30d";

/** Parses a ?range= searchParam value into a known option, falling back to the given default
 *  (e.g. DEFAULT_DATE_RANGE) for anything missing or unrecognized. Server components use this to
 *  turn searchParams into a validated option before computing the actual from/to bounds. */
export function parseDateRange(value: string | undefined, fallback: DateRangeOption = DEFAULT_DATE_RANGE): DateRangeOption {
  return (DATE_RANGE_OPTIONS as readonly string[]).includes(value ?? "") ? (value as DateRangeOption) : fallback;
}

/** Converts a validated DateRangeOption into an ISO "from" bound (or null for "all", meaning no
 *  lower bound at all) computed relative to now. */
export function dateRangeToFromIso(range: DateRangeOption, now: Date = new Date()): string | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return from.toISOString();
}

