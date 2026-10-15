"use client";

import { useActionState } from "react";
import { setSiteGeofenceAction, type SetSiteGeofenceState } from "@/lib/projects/actions";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";

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
        <Tx>Latitude</Tx>
        <input name="site_latitude" defaultValue={latitude ?? ""} inputMode="decimal" placeholder="25.204800" className={input} />
      </label>
      <label className="text-sm text-ink">
        <Tx>Longitude</Tx>
        <input name="site_longitude" defaultValue={longitude ?? ""} inputMode="decimal" placeholder="55.270800" className={input} />
      </label>
      <label className="text-sm text-ink">
        <Tx>Radius (metres)</Tx>
        <input name="site_radius_m" defaultValue={radiusM ?? ""} inputMode="numeric" placeholder="500" className={input} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button type="submit" disabled={pending} >
          {pending ? "Saving…" : "Save site location"}
        </Button>
        {state.saved && <span className="text-xs text-success"><Tx>Saved.</Tx></span>}
        {state.error && <span className="text-xs text-danger">{state.error}</span>}
      </div>
    </form>
  );
}
