"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";

const POPULAR = ["UTC", "Asia/Dubai", "Asia/Riyadh", "Asia/Kolkata", "Europe/London", "America/New_York", "Australia/Sydney"];
const FALLBACK_ZONES = [...POPULAR, "Europe/Paris", "America/Chicago", "America/Los_Angeles", "Asia/Singapore", "Asia/Tokyo"];

function allZones(): string[] {
  try {
    return [...new Set(["UTC", ...Intl.supportedValuesOf("timeZone")])];
  } catch {
    return FALLBACK_ZONES;
  }
}

/** "+04:00" style offset of `zone` right now, or "" if the runtime can't format it. */
function offsetLabel(zone: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    if (!part) return "";
    return part === "GMT" ? "UTC+00:00" : part.replace("GMT", "UTC");
  } catch {
    return "";
  }
}

/** False during server render and hydration, true afterwards: anything that depends on the viewer's own runtime
 *  (their time zone, their ICU data, the current instant) is rendered only once this is true, so the server
 *  HTML and the first client render match. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

function labelFor(zone: string, withOffset: boolean): string {
  const city = zone === "UTC" ? "UTC" : zone.split("/").slice(1).join(" / ").replace(/_/g, " ") || zone;
  const offset = zone === "UTC" || !withOffset ? "" : offsetLabel(zone);
  return offset ? `${city} (${offset})` : city;
}

/**
 * Site time zone picker: a grouped, searchable-by-typing <select> (Common first, then by region)
 * showing each zone's city and current UTC offset, plus a one-click "Use my browser's time zone".
 * Still submits the plain IANA id as `name`, so the server-side validation (parseProjectTimeZone) is
 * unchanged. `blankLabel` is the option for "nothing chosen" (value "").
 */
export function TimeZonePicker({
  name = "timezone",
  defaultValue = "",
  blankLabel,
  className,
}: {
  name?: string;
  defaultValue?: string | null;
  blankLabel: string;
  className?: string;
}) {
  const tl = useTranslate();
  const hydrated = useHydrated();
  // Server and first client render use the same short list; the full runtime list replaces it after hydration.
  const zones = useMemo(() => (hydrated ? allZones() : FALLBACK_ZONES), [hydrated]);
  const [value, setValue] = useState(defaultValue ?? "");
  const known = value === "" || zones.includes(value);

  const groups = useMemo(() => {
    const byRegion = new Map<string, string[]>();
    for (const z of zones) {
      if (POPULAR.includes(z)) continue;
      const region = z.includes("/") ? z.split("/")[0] : "Other";
      byRegion.set(region, [...(byRegion.get(region) ?? []), z]);
    }
    return [...byRegion.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [zones]);

  const browserZone = useMemo(() => {
    if (!hydrated) return "";
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "";
    }
  }, [hydrated]);

  return (
    <div>
      <select name={name} value={value} onChange={(e) => setValue(e.target.value)} className={className}>
        <option value="">{blankLabel}</option>
        {!known && <option value={value}>{value}</option>}
        <optgroup label={tl("Common")}>
          {POPULAR.filter((z) => zones.includes(z)).map((z) => (
            <option key={z} value={z}>
              {labelFor(z, hydrated)}
            </option>
          ))}
        </optgroup>
        {groups.map(([region, list]) => (
          <optgroup key={region} label={region}>
            {list.map((z) => (
              <option key={z} value={z}>
                {labelFor(z, hydrated)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {browserZone && browserZone !== value && zones.includes(browserZone) && (
        <Button type="button" onClick={() => setValue(browserZone)} variant="link" size="sm" className="mt-1">
          {`${tl("Use my browser's time zone")} (${browserZone})`}
        </Button>
      )}
    </div>
  );
}
