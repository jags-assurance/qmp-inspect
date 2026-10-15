"use client";

import { useEffect } from "react";
import { ACTIVE_PROJECT_COOKIE, resolveActiveProjectId } from "./active-project";

function readCookie(name: string): string | undefined {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : undefined;
}

/**
 * Pre-selects the header-chosen project in a "New …" form's project dropdown, once, after mount (so
 * server and client render the same markup). Never overrides a project already chosen or passed in.
 */
export function useActiveProjectDefault(projectIds: readonly string[], current: string, set: (id: string) => void): void {
  useEffect(() => {
    if (current) return;
    const id = resolveActiveProjectId(projectIds, readCookie(ACTIVE_PROJECT_COOKIE));
    if (id) set(id);
    // Only on mount: a later manual change must stick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
