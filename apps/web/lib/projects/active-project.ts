// The project a user is "working in" — chosen once in the header selector and used as the default
// everywhere a project dropdown or filter appears. Stored in a cookie; always validated against the
// projects the user can actually see (RLS-scoped list), so a stale or forged value is ignored.
// Pure (no next/headers) so it unit-tests cleanly.

export const ACTIVE_PROJECT_COOKIE = "qmp_active_project";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value.trim());
}

/** The cookie's project id if it is one of `visibleIds`, else null (= "All projects"). */
export function resolveActiveProjectId(visibleIds: readonly string[], cookieValue: string | null | undefined): string | null {
  const wanted = cookieValue?.trim().toLowerCase();
  if (!wanted || !UUID.test(wanted)) return null;
  return visibleIds.find((id) => id.toLowerCase() === wanted) ?? null;
}

/**
 * Pages that filter on `?project=`: an explicit value (including "" for "All projects") always wins;
 * only a missing param falls back to the header selection.
 */
export function projectParamOrActive(param: string | undefined, activeProjectId: string | null): string | undefined {
  if (param !== undefined) return param;
  return activeProjectId ?? undefined;
}

/** A copy of a page's resolved search params with `project` defaulted to the header selection. */
export function withActiveProject<T extends { project?: string }>(sp: T, activeProjectId: string | null): T {
  const project = projectParamOrActive(sp.project, activeProjectId);
  return project === sp.project ? sp : { ...sp, project };
}
