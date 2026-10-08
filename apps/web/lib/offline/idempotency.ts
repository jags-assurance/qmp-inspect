/**
 * Offline replay / double-submit idempotency. The client key is stored on the record itself
 * (ncrs.request_id, unique per project), so the database is the single arbiter of "already created".
 */
export function sanitizeClientKey(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
}

/**
 * Replay marker for start_inspection. startInspectionAction already resumes an open draft, but a
 * replay AFTER that draft was completed would open a second inspection; the marker (written once the
 * start succeeded) makes the retried item a no-op.
 */
export function startInspectionMarkerPath(projectId: string, clientKey: string): string | null {
  const key = sanitizeClientKey(clientKey);
  const project = projectId.trim().replace(/[^a-zA-Z0-9-]/g, "");
  if (!key || !project) return null;
  return `${project}/inspections/idem-start-${key}.json`;
}
