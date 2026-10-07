import { describe, expect, it } from "vitest";
import { observationMarkerPath, parseObservationMarker, sanitizeClientKey, serializeObservationMarker } from "../idempotency";

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

import { CLAIM_STALE_MS, isStaleClaim, parseMarker, serializeClaimMarker } from "../idempotency";

describe("offline observation claim marker", () => {
  it("round-trips a claim and an NCR marker", () => {
    const claim = parseMarker(serializeClaimMarker(1000));
    expect(claim).toEqual({ kind: "claim", claimedAt: 1000 });
    expect(parseMarker(serializeObservationMarker("abc"))).toEqual({ kind: "ncr", ncrId: "abc" });
  });

  it("treats garbage as unknown", () => {
    expect(parseMarker("not json")).toEqual({ kind: "unknown" });
    expect(parseMarker("{}")).toEqual({ kind: "unknown" });
  });

  it("only takes over a claim once it is stale", () => {
    expect(isStaleClaim(1000, 1000 + CLAIM_STALE_MS - 1)).toBe(false);
    expect(isStaleClaim(1000, 1000 + CLAIM_STALE_MS + 1)).toBe(true);
  });
});

import { observationDonePath } from "../idempotency";

describe("observation done marker", () => {
  it("is a separate object from the claim marker", () => {
    expect(observationDonePath("p1", "k1")).toBe("p1/ncrs/idem-k1.done.json");
    expect(observationDonePath("p1", "")).toBeNull();
  });
});
