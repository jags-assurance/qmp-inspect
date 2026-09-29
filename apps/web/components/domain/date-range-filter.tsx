"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

export const DATE_RANGE_OPTIONS = ["7d", "30d", "90d", "all"] as const;
export type DateRangeOption = (typeof DATE_RANGE_OPTIONS)[number];

const LABELS: Record<DateRangeOption, string> = {
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

/** Plain GET-style filter — mirrors project-filter.tsx: the page itself does all the real work (a
 *  server component reading ?range= from searchParams and applying it to the query), this just
 *  needs to change the URL. No client-side data fetching, no form state: picking a range is a
 *  navigation, not an interaction. */
export function DateRangeFilter({ paramName = "range" }: { paramName?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = parseDateRange(searchParams.get(paramName) ?? undefined);

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-medium text-ink">Date range</span>
      <select
        value={current}
        onChange={(e) => {
          const value = e.target.value;
          const params = new URLSearchParams(searchParams.toString());
          if (value && value !== DEFAULT_DATE_RANGE) params.set(paramName, value);
          else params.delete(paramName);
          const query = params.toString();
          router.push(query ? `${pathname}?${query}` : pathname);
        }}
        className="rounded-md border border-border bg-off-white px-3 py-1.5 text-sm outline-none focus:border-burgundy"
      >
        {DATE_RANGE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {LABELS[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
