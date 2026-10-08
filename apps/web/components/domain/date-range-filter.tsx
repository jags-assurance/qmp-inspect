"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  DATE_RANGE_LABELS,
  DATE_RANGE_OPTIONS,
  DEFAULT_DATE_RANGE,
  parseDateRange,
} from "@/lib/dates/date-range";
import { Tx } from "@/components/domain/tx";

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
      <span className="font-medium text-ink"><Tx>Date range</Tx></span>
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
            {DATE_RANGE_LABELS[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
