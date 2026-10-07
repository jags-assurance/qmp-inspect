/**
 * Pure helpers for offline replay idempotency of raise_observation. There is no DB column for the
 * client key, so a small marker object ("<project>/ncrs/idem-<key>.json" -> NCR id) is stored in
 * the evidence bucket once the NCR exists; a retried sync finds it and skips creation.
 */
export function sanitizeClientKey(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
}

export function observationMarkerPath(projectId: string, clientKey: string): string | null {
  const key = sanitizeClientKey(clientKey);
  const project = projectId.trim().replace(/[^a-zA-Z0-9-]/g, "");
  if (!key || !project) return null;
  return `${project}/ncrs/idem-${key}.json`;
}

export function parseObservationMarker(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { ncrId?: unknown };
    return typeof parsed.ncrId === "string" && parsed.ncrId ? parsed.ncrId : null;
  } catch {
    return null;
  }
}

export function serializeObservationMarker(ncrId: string): string {
  return JSON.stringify({ ncrId });
}
