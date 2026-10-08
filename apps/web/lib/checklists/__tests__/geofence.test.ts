import { describe, expect, it } from "vitest";
import { distanceMeters, evaluateGeofence, sanitiseAccuracy, siteGeofenceFromProject } from "../geofence";

const site = { lat: 25.2048, lng: 55.2708, radiusM: 500 };

describe("distanceMeters", () => {
  it("is zero for the same point", () => {
    expect(distanceMeters(site, site)).toBe(0);
  });
  it("is about 111 km per degree of latitude", () => {
    const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });
});

describe("siteGeofenceFromProject", () => {
  it("returns null when not configured", () => {
    expect(siteGeofenceFromProject({})).toBeNull();
    expect(siteGeofenceFromProject({ site_latitude: 25, site_longitude: null })).toBeNull();
  });
  it("rejects out-of-range values and defaults the radius", () => {
    expect(siteGeofenceFromProject({ site_latitude: 95, site_longitude: 10 })).toBeNull();
    expect(siteGeofenceFromProject({ site_latitude: "25.2", site_longitude: "55.2" })).toEqual({ lat: 25.2, lng: 55.2, radiusM: 500 });
    expect(siteGeofenceFromProject({ site_latitude: 1, site_longitude: 2, site_radius_m: 250 })?.radiusM).toBe(250);
  });
});

describe("evaluateGeofence", () => {
  it("not configured never warns", () => {
    expect(evaluateGeofence(null, { lat: 1, lng: 1 }, 5)).toEqual({ status: "not_configured", distanceM: null, warning: null });
  });
  it("a named location is unknown, without a warning", () => {
    expect(evaluateGeofence(site, null, null).status).toBe("unknown");
  });
  it("inside the radius", () => {
    const r = evaluateGeofence(site, { lat: 25.2049, lng: 55.2709 }, 10);
    expect(r.status).toBe("inside");
    expect(r.warning).toBeNull();
  });
  it("outside warns with the distance", () => {
    const r = evaluateGeofence(site, { lat: 25.3048, lng: 55.2708 }, 10);
    expect(r.status).toBe("outside");
    expect(r.warning).toMatch(/km from the project site/);
  });
  it("gives the benefit of the doubt for a large accuracy radius", () => {
    // ~700 m away, accuracy 300 m: best case 400 m, inside 500 m.
    const r = evaluateGeofence(site, { lat: 25.2048 + 0.0063, lng: 55.2708 }, 300);
    expect(r.status).toBe("inside");
    expect(r.warning).toMatch(/accuracy is poor/);
  });
});

describe("sanitiseAccuracy", () => {
  it("accepts numbers and strings, rejects junk", () => {
    expect(sanitiseAccuracy("12.34")).toBe(12.3);
    expect(sanitiseAccuracy(-1)).toBeNull();
    expect(sanitiseAccuracy("abc")).toBeNull();
    expect(sanitiseAccuracy("")).toBeNull();
    expect(sanitiseAccuracy(1e9)).toBe(99999);
  });
});

import { parseSiteGeofenceForm } from "../geofence";

describe("parseSiteGeofenceForm", () => {
  it("blank clears", () => {
    expect(parseSiteGeofenceForm("", "", "")).toEqual({ value: null });
  });
  it("parses separate fields with default radius", () => {
    expect(parseSiteGeofenceForm("25.2", "55.3", "")).toEqual({ value: { lat: 25.2, lng: 55.3, radiusM: 500 } });
  });
  it("accepts a pasted pair", () => {
    expect(parseSiteGeofenceForm("25.2048, 55.2708", "", "300")).toEqual({ value: { lat: 25.2048, lng: 55.2708, radiusM: 300 } });
  });
  it("rejects bad input", () => {
    expect("error" in parseSiteGeofenceForm("95", "10", "")).toBe(true);
    expect("error" in parseSiteGeofenceForm("25", "", "")).toBe(true);
    expect("error" in parseSiteGeofenceForm("25", "55", "5")).toBe(true);
  });
});
