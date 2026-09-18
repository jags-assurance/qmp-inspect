"use client";

import { useEffect, useRef, useState } from "react";

export interface ReportPackListItemLike {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
}

// Same cadence as usePdfPolling (lib/reports/use-pdf-polling.ts) — the worker renders in ~5-10s in
// practice, so this feels immediate without polling faster than that's worth.
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 40;

/**
 * Same "queue a background job, then wait for it" behaviour as usePdfPolling, but for a whole list
 * of report packs (weekly/monthly) rather than one "latest" record — every poll tick refetches the
 * entire list and replaces local state with it, which is cheap here since both lists are capped
 * (24 monthly / 52 weekly rows) and it's simpler and no less correct than patching one row in place.
 *
 * fetchList must be a stable function reference (a module-level server action export, not an inline
 * arrow — inline functions would restart the polling interval's effect on every render).
 */
export function useReportPackListPolling<T extends ReportPackListItemLike>(
  initialItems: T[],
  fetchList: (organizationId: string) => Promise<T[]>,
  organizationId: string
) {
  const [items, setItems] = useState<T[]>(initialItems);
  const [polling, setPolling] = useState(false);
  const pollCountRef = useRef(0);

  function startPolling() {
    setPolling(true);
    pollCountRef.current = 0;
  }

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;

    const timer = setInterval(async () => {
      pollCountRef.current += 1;
      const next = await fetchList(organizationId);
      if (cancelled) return;
      setItems(next);
      const stillPending = next.some((item) => item.status === "pending" || item.status === "processing");
      if (!stillPending || pollCountRef.current >= MAX_POLLS) {
        setPolling(false);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // fetchList is documented as a stable module-level reference; organizationId is the only real
    // dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, organizationId]);

  return { items, polling, startPolling };
}
