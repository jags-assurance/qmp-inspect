"use client";

import { useActionState, useRef, useState } from "react";
import { startInspectionAction, type StartInspectionState } from "@/lib/checklists/actions";
import { Button } from "@/components/ui/button";

const initialState: StartInspectionState = { error: null };

export function StartInspectionForm({
  templateId,
  itpItemId,
  projectId,
  projectName,
  itpNumber,
  activity,
  locationPresets = [],
}: {
  templateId: string;
  itpItemId: string;
  projectId: string;
  projectName: string;
  itpNumber: string;
  activity: string;
  /** Org/project-configured preset location names — see lib/checklists/location-presets.ts. Empty
   *  when none are configured; the free-text input below always still works either way. */
  locationPresets?: string[];
}) {
  const [state, formAction, pending] = useActionState(startInspectionAction, initialState);
  const locationRef = useRef<HTMLInputElement>(null);
  const [locating, setLocating] = useState(false);
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Real device GPS, not a fabricated value. Previously only ever appended raw "lat, lng" text —
  // real gap found live: the app stored coordinates but never resolved them to an actual street
  // address, even though the field (and the generated report) is meant to read as a human location.
  // Reverse-geocodes via OpenStreetMap's Nominatim (free, no API key/account needed — the right
  // choice here since it needs no secret this session could set up on the user's behalf) and
  // prefixes the resolved address ahead of the coordinates; falls back to coordinates alone if the
  // lookup fails (offline, rate-limited, or genuinely no match) — never blocks starting the
  // inspection over it. Appends to whatever's already typed rather than replacing it, since a free-
  // text description ("Block C, Level 2") is still useful alongside a real address.
  async function useMyLocation() {
    if (!navigator.geolocation) {
      setLocationError("Geolocation isn't available on this device/browser.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const coords = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        setLocating(false);
        setResolvingAddress(true);

        let locationText = coords;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=0`,
            { signal: controller.signal, headers: { Accept: "application/json" } }
          );
          clearTimeout(timeout);
          if (res.ok) {
            const data = (await res.json()) as { display_name?: string };
            if (data.display_name) locationText = `${data.display_name} (${coords})`;
          }
        } catch {
          // Best-effort — offline or the lookup failed; the raw coordinates alone are still useful
          // and already what this field stored before reverse geocoding existed.
        }

        if (locationRef.current) {
          const existing = locationRef.current.value.trim();
          locationRef.current.value = existing ? `${existing} (${locationText})` : locationText;
        }
        setResolvingAddress(false);
      },
      () => {
        setLocationError("Could not get your location — enter it manually instead.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <form action={formAction} className="rounded-lg border border-border bg-surface p-6">
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="itp_item_id" value={itpItemId} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="project_name" value={projectName} />
      <input type="hidden" name="itp_number" value={itpNumber} />
      <input type="hidden" name="activity" value={activity} />

      <label htmlFor="location" className="block text-sm font-medium text-ink">
        Location (optional)
      </label>
      {locationPresets.length > 0 && (
        <select
          aria-label="Preset location"
          defaultValue=""
          onChange={(e) => {
            const value = e.target.value;
            if (!value || !locationRef.current) return;
            const existing = locationRef.current.value.trim();
            locationRef.current.value = existing ? `${existing}, ${value}` : value;
            e.target.value = "";
          }}
          className="mt-1 w-full max-w-md rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value="">— Pick a preset location —</option>
          {locationPresets.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
      <div className="mt-1 flex max-w-md gap-2">
        <input
          ref={locationRef}
          id="location"
          name="location"
          placeholder="e.g. Block C, Level 2"
          className="w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating || resolvingAddress}
          className="shrink-0 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-off-white disabled:opacity-50"
        >
          {locating ? "Locating…" : resolvingAddress ? "Resolving address…" : "📍 Use my location"}
        </button>
      </div>
      {locationError && <p className="mt-1 text-xs text-danger">{locationError}</p>}
      <p className="mt-1 text-xs text-muted">Resolves your coordinates to a street address automatically (via OpenStreetMap) — the coordinates are always kept too.</p>

      <Button type="submit" disabled={pending} className="mt-4">
        {pending ? "Starting…" : "Start inspection"}
      </Button>
      {state.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
