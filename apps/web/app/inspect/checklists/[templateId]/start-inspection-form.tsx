"use client";

import { useActionState, useState } from "react";
import { startInspectionAction, type StartInspectionState } from "@/lib/checklists/actions";
import { Button } from "@/components/ui/button";
import { enqueueOutboxItem } from "@/lib/offline/db";
import { notifyOutboxChanged } from "@/lib/offline/sync-client";
import { evaluateGeofence, type SiteGeofence } from "@/lib/checklists/geofence";
import { parseCoordinates } from "@/lib/checklists/location";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: StartInspectionState = { error: null };

export function StartInspectionForm({
  templateId,
  itpItemId,
  projectId,
  projectName,
  itpNumber,
  activity,
  locationPresets = [],
  siteGeofence = null,
}: {
  templateId: string;
  itpItemId: string;
  projectId: string;
  projectName: string;
  itpNumber: string;
  activity: string;
  /** This project's own location names (project settings → locations — see
   *  lib/checklists/location-presets.ts). They differ per project; empty when none are set up. */
  locationPresets?: string[];
  /** Project site point + radius for the soft geofence warning (S4-17); null when not configured. */
  siteGeofence?: SiteGeofence | null;
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(startInspectionAction, initialState);
  // One location at a time: either a live GPS reading (latitude/longitude only) or one of this
  // project's own locations. Choosing one replaces the other — they are never combined.
  const [source, setSource] = useState<"none" | "gps" | "preset">("none");
  const [value, setValue] = useState("");
  const [presetChoice, setPresetChoice] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Offline: keep the start request on this device; it is replayed (once) when the connection returns
  // and the inspection then opens. Answers can only be recorded after it has started.
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    setQueued(false);
    setQueueError(null);
    if (navigator.onLine) return;
    e.preventDefault();
    if (!value) return;
    try {
      await enqueueOutboxItem({
        kind: "start_inspection",
        fields: { kind: "start_inspection", template_id: templateId, itp_item_id: itpItemId, project_id: projectId, location: value },
      });
      notifyOutboxChanged();
      setQueued(true);
    } catch (err) {
      console.error("[start-inspection] offline queue failed", err);
      setQueueError("Could not save the start request offline.");
    }
  }
  const [accuracy, setAccuracy] = useState<number | null>(null);

  function useLiveLocation() {
    if (!navigator.geolocation) {
      setLocationError("Live location isn't available on this device or browser.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy: acc } = position.coords;
        setAccuracy(Number.isFinite(acc) ? Math.round(acc * 10) / 10 : null);
        setValue(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
        setSource("gps");
        setPresetChoice("");
        setLocating(false);
      },
      () => {
        setLocationError(
          locationPresets.length > 0
            ? "Could not read your live location — allow location access, or choose a project location instead."
            : "Could not read your live location. Allow location access for this site in your browser settings and try again, or ask an admin to add project locations."
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function choosePreset(name: string) {
    setPresetChoice(name);
    setAccuracy(null);
    if (name) {
      setValue(name);
      setSource("preset");
    } else {
      setValue("");
      setSource("none");
    }
  }

  function clearLocation() {
    setValue("");
    setSource("none");
    setPresetChoice("");
    setLocationError(null);
    setAccuracy(null);
  }

  const geofence = source === "gps" ? evaluateGeofence(siteGeofence, parseCoordinates(value), accuracy) : null;

  return (
    <form action={formAction} onSubmit={onSubmit} className="rounded-lg border border-border bg-surface p-6">
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="itp_item_id" value={itpItemId} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="project_name" value={projectName} />
      <input type="hidden" name="itp_number" value={itpNumber} />
      <input type="hidden" name="activity" value={activity} />
      <input type="hidden" name="location" value={value} />
      <input type="hidden" name="location_accuracy" value={source === "gps" && accuracy != null ? String(accuracy) : ""} />

      <p className="block text-sm font-medium text-ink">
        <Tx>Location</Tx> <span className="text-danger">*</span> <span className="font-normal text-muted"><Tx>(required to start)</Tx></span>
      </p>
      <p className="mt-0.5 text-xs text-muted">
        <Tx>Use your live location, or pick one of this project&apos;s own locations. Choosing one replaces the other.</Tx>
      </p>

      <div className="mt-2 flex max-w-xl flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={useLiveLocation}
          disabled={locating}
          className={`rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50 ${
            source === "gps" ? "border-burgundy bg-burgundy/5 text-burgundy" : "border-border bg-surface text-ink hover:bg-surface-subtle"
          }`}
        >
          {locating ? "Locating…" : "📍 Use live location"}
        </button>
        {locationPresets.length > 0 && (
          <select
            aria-label={tl("Project location")}
            value={presetChoice}
            onChange={(e) => choosePreset(e.target.value)}
            className={`min-w-48 flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:border-burgundy ${
              source === "preset" ? "border-burgundy bg-burgundy/5" : "border-border bg-off-white"
            }`}
          >
            <option value=""><Tx>— Project location —</Tx></option>
            {locationPresets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>
      {locationPresets.length === 0 && (
        <p className="mt-1 text-xs text-muted">
          <Tx>No project locations are set up yet — an admin can add them in the project&apos;s location settings.</Tx>
        </p>
      )}

      {value ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink">
          <span className="font-medium">{source === "gps" ? "Live location (latitude, longitude):" : "Project location:"}</span>
          <span className="doc-id">{value}</span>
          <Button type="button" onClick={clearLocation} variant="link" size="sm">
            <Tx>Clear</Tx>
          </Button>
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted"><Tx>No location selected.</Tx></p>
      )}
      {source === "gps" && accuracy != null && <p className="mt-1 text-xs text-muted"><Tx>Accuracy about</Tx> {Math.round(accuracy)} m.</p>}
      {geofence?.warning && (
        <p className="mt-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-ink" role="status">
          {geofence.warning} <Tx>You can still start; this is recorded with the inspection.</Tx>
        </p>
      )}
      {locationError && <p role="alert" className="mt-1 text-xs text-danger">{locationError}</p>}

      <Button type="submit" disabled={pending || !value} className="mt-4">
        {pending ? "Starting…" : "Start inspection"}
      </Button>
      {state.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
      {queueError && <p role="alert" className="mt-2 text-sm text-danger">{queueError}</p>}
      {queued && (
        <p role="status" className="mt-2 text-sm text-muted">
          <Tx>Saved on this device. The inspection will start automatically when you are back online; reload this page then to begin answering.</Tx>
        </p>
      )}
    </form>
  );
}
