// S4-17: soft site geofence for "start inspection". Pure functions, no Supabase, unit-tested.
// A warning only: GPS is poor indoors and in shielded plant, so nothing here ever blocks work.

import type { Coordinates } from "./location";

export type GeofenceStatus = "inside" | "outside" | "unknown" | "not_configured";

export interface SiteGeofence {
  lat: number;
  lng: number;
  radiusM: number;
}

export const DEFAULT_GEOFENCE_RADIUS_M = 500;
/** Readings worse than this are too imprecise to say whether someone is on site. */
export const POOR_ACCURACY_M = 100;

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Builds the geofence from project columns; null when the site point is not configured or invalid. */
export function siteGeofenceFromProject(p: {
  site_latitude?: number | string | null;
  site_longitude?: number | string | null;
  site_radius_m?: number | string | null;
}): SiteGeofence | null {
  if (p.site_latitude == null || p.site_longitude == null) return null;
  const lat = Number(p.site_latitude);
  const lng = Number(p.site_longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const r = p.site_radius_m == null ? DEFAULT_GEOFENCE_RADIUS_M : Number(p.site_radius_m);
  return { lat, lng, radiusM: Number.isFinite(r) && r > 0 ? r : DEFAULT_GEOFENCE_RADIUS_M };
}

export interface GeofenceCheck {
  status: GeofenceStatus;
  distanceM: number | null;
  /** Human-readable warning, null when nothing needs saying. */
  warning: string | null;
}

/**
 * `position` is null when the inspector picked a named project location instead of live GPS.
 * A reading is "inside" when the distance minus the reported accuracy is within the radius (benefit
 * of the doubt), "outside" only when even the best case is beyond it.
 */
export function evaluateGeofence(
  site: SiteGeofence | null,
  position: Coordinates | null,
  accuracyM: number | null | undefined
): GeofenceCheck {
  if (!site) return { status: "not_configured", distanceM: null, warning: null };
  if (!position) return { status: "unknown", distanceM: null, warning: null };
  const distanceM = Math.round(distanceMeters(site, position));
  const acc = accuracyM != null && Number.isFinite(accuracyM) && accuracyM >= 0 ? accuracyM : 0;
  if (distanceM - acc <= site.radiusM) {
    return {
      status: "inside",
      distanceM,
      warning: acc > POOR_ACCURACY_M ? `Location accuracy is poor (about ${Math.round(acc)} m), so the position is only approximate.` : null,
    };
  }
  return {
    status: "outside",
    distanceM,
    warning: `This location is about ${formatDistance(distanceM)} from the project site (limit ${formatDistance(site.radiusM)}). Check you are at the right place.`,
  };
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** Clamps a client-supplied accuracy reading to a sane stored value; null when unusable. */
export function sanitiseAccuracy(raw: unknown): number | null {
  if (raw == null || (typeof raw === "string" && !raw.trim())) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.round(n * 10) / 10, 99999);
}

/**
 * Parses the project-settings form. All blank clears the geofence (value null). Accepts a pasted
 * "lat, lng" in the latitude box, as copied from a maps app.
 */
export function parseSiteGeofenceForm(
  latRaw: string,
  lngRaw: string,
  radiusRaw: string
): { value: { lat: number; lng: number; radiusM: number } | null } | { error: string } {
  let lat = latRaw.trim();
  let lng = lngRaw.trim();
  const radius = radiusRaw.trim();
  if (!lat && !lng) return { value: null };
  const pasted = lat.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (pasted && !lng) {
    lat = pasted[1];
    lng = pasted[2];
  }
  const la = Number(lat);
  const lo = Number(lng);
  if (!lat || !lng || !Number.isFinite(la) || !Number.isFinite(lo)) return { error: "Enter both a latitude and a longitude." };
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return { error: "Latitude must be within -90 to 90 and longitude within -180 to 180." };
  const r = radius ? Number(radius) : DEFAULT_GEOFENCE_RADIUS_M;
  if (!Number.isFinite(r) || r < 10 || r > 100000) return { error: "The radius must be between 10 and 100000 metres." };
  return { value: { lat: la, lng: lo, radiusM: Math.round(r) } };
}
