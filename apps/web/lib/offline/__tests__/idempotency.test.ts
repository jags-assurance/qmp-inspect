import { describe, expect, it } from "vitest";
import { sanitizeClientKey } from "../idempotency";

describe("offline idempotency key", () => {
  it("sanitizes keys", () => {
    expect(sanitizeClientKey("ab/../c-1")).toBe("abc-1");
    expect(sanitizeClientKey(null)).toBe("");
    expect(sanitizeClientKey(undefined)).toBe("");
  });
  it("caps the key at the ncrs.request_id column limit", () => {
    expect(sanitizeClientKey("a".repeat(100))).toHaveLength(64);
  });
});
