// Pure helpers for project-scoped weekly / monthly report packs. A pack with no project_id is the
// organisation-wide pack exactly as before; with a project_id it covers that one project.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The project id to scope to, or null for the whole organisation. Anything that is not a UUID is treated as unscoped by the caller after validation. */
export function normaliseProjectId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return UUID.test(v) ? v.toLowerCase() : null;
}

/** Scope for a job payload: null/empty = whole organisation; a malformed id FAILS the job rather than silently widening it to the organisation. */
export function resolveProjectScope(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const id = normaliseProjectId(raw);
  if (!id) throw new Error("Invalid project_id in the report pack payload");
  return id;
}

/** Storage folder: project packs get their own sub-folder so they never mix with the organisation pack. */
export function packBasePath(kind: "weekly-reports" | "monthly-reports", organizationId: string, periodTag: string, projectId: string | null): string {
  return projectId ? `${kind}/${organizationId}/projects/${projectId}/${periodTag}` : `${kind}/${organizationId}/${periodTag}`;
}

/** Vault document reference: a project pack must not collide with the organisation pack of the same period. */
export function packDocumentReference(base: string, projectId: string | null): string {
  return projectId ? `${base}-PROJECT` : base;
}
