import { describe, it, expect } from "vitest";
import { parseCoordinates, formatCoordinates, formatLocationForDisplay, mapsUrl, normaliseLocation } from "../location";

describe("parseCoordinates", () => {
  it("returns null for empty/no pair", () => {
    expect(parseCoordinates(null)).toBeNull();
    expect(parseCoordinates(undefined)).toBeNull();
    expect(parseCoordinates("")).toBeNull();
    expect(parseCoordinates("Tank farm area 3")).toBeNull();
    expect(parseCoordinates("12, 77")).toBeNull(); // integers are not a decimal pair
  });
  it("parses a plain pair", () => {
    expect(parseCoordinates("12.971599, 77.594566")).toEqual({ lat: 12.971599, lng: 77.594566 });
  });
  it("takes the LAST pair in legacy 'address (lat, lng)' text", () => {
    expect(parseCoordinates("Plot 1.5, 2.5 Road (13.000000, 80.250000)")).toEqual({ lat: 13, lng: 80.25 });
  });
  it("handles negatives and no spaces", () => {
    expect(parseCoordinates("-33.865143,151.209900")).toEqual({ lat: -33.865143, lng: 151.2099 });
  });
  it("rejects out-of-range values", () => {
    expect(parseCoordinates("90.5, 10.0")).toBeNull();
    expect(parseCoordinates("10.0, 180.5")).toBeNull();
    expect(parseCoordinates("-91.0, 10.0")).toBeNull();
    expect(parseCoordinates("90.0, 180.0")).toEqual({ lat: 90, lng: 180 });
  });
});

describe("formatting helpers", () => {
  it("formatCoordinates uses 6 dp", () => {
    expect(formatCoordinates({ lat: 1.5, lng: -2.25 })).toBe("1.500000, -2.250000");
  });
  it("formatLocationForDisplay", () => {
    expect(formatLocationForDisplay(null)).toBe("—");
    expect(formatLocationForDisplay("")).toBe("—");
    expect(formatLocationForDisplay("Unit A")).toBe("Unit A");
    expect(formatLocationForDisplay("12.5, 77.5")).toBe("Lat 12.500000, Long 77.500000");
  });
  it("mapsUrl", () => {
    expect(mapsUrl("Unit A")).toBeNull();
    expect(mapsUrl(null)).toBeNull();
    expect(mapsUrl("12.5, 77.5")).toBe("https://www.google.com/maps?q=12.500000,77.500000");
  });
});

describe("normaliseLocation", () => {
  const presets = ["Tank Farm", "Jetty 2"];
  it("empty -> null value", () => {
    expect(normaliseLocation("   ", presets)).toEqual({ value: null });
  });
  it("coordinates are reduced to 'lat, lng'", () => {
    expect(normaliseLocation("Site office (12.5, 77.5)", presets)).toEqual({ value: "12.500000, 77.500000" });
  });
  it("reports out-of-range coordinates", () => {
    expect(normaliseLocation("95.5, 10.5", presets)).toHaveProperty("error");
  });
  it("accepts a preset case-insensitively, returning canonical name", () => {
    expect(normaliseLocation("  tank farm ", presets)).toEqual({ value: "Tank Farm" });
  });
  it("rejects free-text place names", () => {
    expect(normaliseLocation("Behind the warehouse", presets)).toHaveProperty("error");
    expect(normaliseLocation("Tank Farm", [])).toHaveProperty("error");
  });
  it("is repeatable (global regex lastIndex not leaking between calls)", () => {
    for (let i = 0; i < 4; i++) {
      expect(normaliseLocation("12.5, 77.5", presets)).toEqual({ value: "12.500000, 77.500000" });
    }
    expect(normaliseLocation("Jetty 2", presets)).toEqual({ value: "Jetty 2" });
  });
});
