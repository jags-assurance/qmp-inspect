// A live inspection location is ONE latitude/longitude pair — never a place name. The only other
// allowed value is the name of one of the project's own location presets.

const PAIR_RE = /(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g;

export interface Coordinates {
  lat: number;
  lng: number;
}

/** Extracts the LAST decimal coordinate pair in the text (older records held "address (lat, lng)"). */
export function parseCoordinates(text: string | null | undefined): Coordinates | null {
  if (!text) return null;
  let last: RegExpExecArray | null = null;
  for (const m of text.matchAll(PAIR_RE)) last = m;
  if (!last) return null;
  const lat = Number(last[1]);
  const lng = Number(last[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function formatCoordinates(c: Coordinates): string {
  return `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`;
}

/** 'Lat x, Long y' for coordinates, the preset name as-is otherwise. */
export function formatLocationForDisplay(text: string | null | undefined): string {
  if (!text) return "—";
  const c = parseCoordinates(text);
  if (c) return `Lat ${c.lat.toFixed(6)}, Long ${c.lng.toFixed(6)}`;
  return text;
}

export function mapsUrl(text: string | null | undefined): string | null {
  const c = parseCoordinates(text);
  return c ? `https://www.google.com/maps?q=${c.lat.toFixed(6)},${c.lng.toFixed(6)}` : null;
}

/**
 * Server-side normalisation. Returns { value } (null = no location) or { error }.
 * A string containing a decimal pair is reduced to "lat, lng"; otherwise it must equal a preset.
 */
export function normaliseLocation(
  raw: string,
  presetNames: string[]
): { value: string | null } | { error: string } {
  const text = raw.trim();
  if (!text) return { value: null };
  if (/\d\.\d/.test(text) && PAIR_RE.test(text)) {
    PAIR_RE.lastIndex = 0;
    const c = parseCoordinates(text);
    if (!c) return { error: "The coordinates are out of range (latitude -90 to 90, longitude -180 to 180)." };
    return { value: formatCoordinates(c) };
  }
  PAIR_RE.lastIndex = 0;
  const hit = presetNames.find((n) => n.trim().toLowerCase() === text.toLowerCase());
  if (hit) return { value: hit };
  return { error: "Choose live location or one of the project's locations — typed place names aren't accepted." };
}
