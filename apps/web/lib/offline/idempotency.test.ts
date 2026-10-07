import { describe, expect, it } from "vitest";
import { observationMarkerPath, parseObservationMarker, sanitizeClientKey, serializeObservationMarker } from "./idempotency";

describe("offline observation idempotency", () => {
  it("sanitizes keys", () => {
    expect(sanitizeClientKey("ab/../c-1")).toBe("abc-1");
    expect(sanitizeClientKey(null)).toBe("");
  });
  it("builds a deterministic marker path", () => {
    expect(observationMarkerPath("p1", "k-1")).toBe("p1/ncrs/idem-k-1.json");
    expect(observationMarkerPath("p1", "k-1")).toBe(observationMarkerPath("p1", "k-1"));
  });
  it("returns null without key or project", () => {
    expect(observationMarkerPath("p1", "")).toBeNull();
    expect(observationMarkerPath("", "k")).toBeNull();
  });
  it("round-trips markers", () => {
    expect(parseObservationMarker(serializeObservationMarker("n1"))).toBe("n1");
    expect(parseObservationMarker("garbage")).toBeNull();
  });
});
