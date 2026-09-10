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
}: {
  templateId: string;
  itpItemId: string;
  projectId: string;
  projectName: string;
  itpNumber: string;
  activity: string;
}) {
  const [state, formAction, pending] = useActionState(startInspectionAction, initialState);
  const locationRef = useRef<HTMLInputElement>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Real device GPS, not a fabricated value — appends "lat, lng" to whatever the inspector has
  // already typed rather than replacing it, since a free-text description ("Block C, Level 2") is
  // still more useful to a human reader than raw coordinates alone.
  function useMyLocation() {
    if (!navigator.geolocation) {
      setLocationError("Geolocation isn't available on this device/browser.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const coords = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        if (locationRef.current) {
          const existing = locationRef.current.value.trim();
          locationRef.current.value = existing ? `${existing} (${coords})` : coords;
        }
        setLocating(false);
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
          disabled={locating}
          className="shrink-0 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-off-white disabled:opacity-50"
        >
          {locating ? "Locating…" : "📍 Use my location"}
        </button>
      </div>
      {locationError && <p className="mt-1 text-xs text-danger">{locationError}</p>}

      <Button type="submit" disabled={pending} className="mt-4">
        {pending ? "Starting…" : "Start inspection"}
      </Button>
      {state.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
