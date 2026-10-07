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

/** A claim marker is written BEFORE the NCR is created (atomic create-if-absent in storage), so two
 *  simultaneous requests with one key cannot both proceed. It is replaced by the NCR marker after. */
export const CLAIM_STALE_MS = 2 * 60 * 1000;

export function serializeClaimMarker(now: number = Date.now()): string {
  return JSON.stringify({ claimedAt: now });
}

export type ParsedMarker = { kind: "ncr"; ncrId: string } | { kind: "claim"; claimedAt: number } | { kind: "unknown" };

/** The result marker lives in its OWN object (never an overwrite of the claim), so it needs only
 *  insert permission on the bucket. */
export function observationDonePath(projectId: string, clientKey: string): string | null {
  const claim = observationMarkerPath(projectId, clientKey);
  return claim ? claim.replace(/\.json$/, ".done.json") : null;
}

export function parseMarker(text: string): ParsedMarker {
  try {
    const parsed = JSON.parse(text) as { ncrId?: unknown; claimedAt?: unknown };
    if (typeof parsed.ncrId === "string" && parsed.ncrId) return { kind: "ncr", ncrId: parsed.ncrId };
    if (typeof parsed.claimedAt === "number") return { kind: "claim", claimedAt: parsed.claimedAt };
  } catch {
    // fall through
  }
  return { kind: "unknown" };
}

/** A claim older than this is assumed abandoned (the claiming request crashed) and may be taken over. */
export function isStaleClaim(claimedAt: number, now: number = Date.now()): boolean {
  return now - claimedAt > CLAIM_STALE_MS;
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
