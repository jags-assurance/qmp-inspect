"use client";

import { useActionState } from "react";
import { setSiteGeofenceAction, type SetSiteGeofenceState } from "@/lib/projects/actions";

const initialState: SetSiteGeofenceState = { error: null };

/** Site point + radius for the soft "are you at the site" warning on start inspection (S4-17). */
export function SiteGeofenceSettings({
  projectId,
  latitude,
  longitude,
  radiusM,
}: {
  projectId: string;
  latitude: number | null;
  longitude: number | null;
  radiusM: number | null;
}) {
  const [state, formAction, pending] = useActionState(setSiteGeofenceAction, initialState);
  const input = "min-h-10 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy";
  return (
    <form action={formAction} className="mt-3 grid max-w-2xl gap-3 sm:grid-cols-3">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="text-sm text-ink">
        Latitude
        <input name="site_latitude" defaultValue={latitude ?? ""} inputMode="decimal" placeholder="25.204800" className={input} />
      </label>
      <label className="text-sm text-ink">
        Longitude
        <input name="site_longitude" defaultValue={longitude ?? ""} inputMode="decimal" placeholder="55.270800" className={input} />
      </label>
      <label className="text-sm text-ink">
        Radius (metres)
        <input name="site_radius_m" defaultValue={radiusM ?? ""} inputMode="numeric" placeholder="500" className={input} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-3">
        <button type="submit" disabled={pending} className="min-h-10 rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Saving…" : "Save site location"}
        </button>
        {state.saved && <span className="text-xs text-success">Saved.</span>}
        {state.error && <span className="text-xs text-danger">{state.error}</span>}
      </div>
    </form>
  );
}
