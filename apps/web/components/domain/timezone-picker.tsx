"use client";

import { useMemo, useState } from "react";
import { useTranslate } from "@/lib/i18n/locale-context";

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

function labelFor(zone: string): string {
  const city = zone === "UTC" ? "UTC" : zone.split("/").slice(1).join(" / ").replace(/_/g, " ") || zone;
  const offset = zone === "UTC" ? "" : offsetLabel(zone);
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
  const zones = useMemo(() => allZones(), []);
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
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "";
    }
  }, []);

  return (
    <div>
      <select name={name} value={value} onChange={(e) => setValue(e.target.value)} className={className}>
        <option value="">{blankLabel}</option>
        {!known && <option value={value}>{value}</option>}
        <optgroup label={tl("Common")}>
          {POPULAR.filter((z) => zones.includes(z)).map((z) => (
            <option key={z} value={z}>
              {labelFor(z)}
            </option>
          ))}
        </optgroup>
        {groups.map(([region, list]) => (
          <optgroup key={region} label={region}>
            {list.map((z) => (
              <option key={z} value={z}>
                {labelFor(z)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {browserZone && browserZone !== value && zones.includes(browserZone) && (
        <button type="button" onClick={() => setValue(browserZone)} className="mt-1 text-xs font-medium text-burgundy hover:underline">
          {`${tl("Use my browser's time zone")} (${browserZone})`}
        </button>
      )}
    </div>
  );
}
