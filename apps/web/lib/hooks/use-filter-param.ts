"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Returns a function that sets (or clears, for "") ONE query param on the current URL while keeping every
 * other param, and resets paging / the open detail pane. Register filter selects use it so changing the
 * discipline no longer drops the phase, sort, status chip or search (each plain GET <form> only submits
 * its own field). The surrounding <form> stays as the no-JavaScript fallback.
 */
export function useSetFilterParam() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return useCallback(
    (name: string, value: string) => {
      const next = new URLSearchParams(search.toString());
      if (value) next.set(name, value);
      else next.delete(name);
      next.delete("page");
      next.delete("itp");
      next.delete("pane");
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, search]
  );
}
