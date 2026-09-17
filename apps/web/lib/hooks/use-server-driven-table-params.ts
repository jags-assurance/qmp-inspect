"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Shared "?q=&page=" URL-sync logic behind the server-driven search + pagination pattern used by
 * NcrsTable, ItpsTable and StandaloneTable (all following the same round-table performance finding:
 * registers used to receive and client-filter every matching row at once). Extracted verbatim from
 * those three near-identical copies — no behavior change, just one place to fix instead of three.
 *
 * Pass `enabled` as the caller's own `serverDriven` flag (e.g. `totalCount !== undefined`). When
 * `false`, the hook still runs (hooks can't be called conditionally) but never pushes URL updates,
 * matching each caller's original `if (!serverDriven) return;` guard inside the debounce effect.
 */
export function useServerDrivenTableParams(enabled: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (!enabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // A new search always jumps back to page 1 — staying on e.g. page 4 of a narrowed-down
      // result set almost always lands past the end and shows an empty table.
      pushParams({ q: searchValue || null, page: null });
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue, enabled]);

  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const goToPage = useCallback(
    (nextPage: number) => pushParams({ page: nextPage === 1 ? null : String(nextPage) }),
    [pushParams]
  );

  return { searchValue, setSearchValue, page, goToPage };
}
