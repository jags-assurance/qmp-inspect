import { describe, expect, it } from "vitest";
import { checkOfflineSyncOrigin, type OriginCheckInput } from "../origin-check";

const base: OriginCheckInput = {
  origin: null,
  secFetchSite: null,
  host: "app.example.com",
  forwardedHost: null,
  appUrl: "https://app.example.com",
  idempotencyKey: "abc-123",
};
const check = (over: Partial<OriginCheckInput>) => checkOfflineSyncOrigin({ ...base, ...over });

describe("checkOfflineSyncOrigin", () => {
  it("requires the idempotency header", () => {
    expect(check({ idempotencyKey: null }).ok).toBe(false);
    expect(check({ idempotencyKey: "  " }).ok).toBe(false);
  });
  it("accepts same-origin by Sec-Fetch-Site", () => {
    expect(check({ secFetchSite: "same-origin" }).ok).toBe(true);
  });
  it("refuses cross-site and same-site by Sec-Fetch-Site, even with a matching origin", () => {
    expect(check({ secFetchSite: "cross-site", origin: "https://app.example.com" }).ok).toBe(false);
    expect(check({ secFetchSite: "same-site" }).ok).toBe(false);
    expect(check({ secFetchSite: "none" }).ok).toBe(false);
  });
  it("falls back to the Origin header", () => {
    expect(check({ origin: "https://app.example.com" }).ok).toBe(true);
    expect(check({ origin: "https://evil.example.net" }).ok).toBe(false);
    expect(check({ origin: "null" }).ok).toBe(false);
    expect(check({ origin: "not a url" }).ok).toBe(false);
  });
  it("accepts the forwarded host and the configured app URL", () => {
    expect(check({ origin: "https://proxy.example.org", host: "internal:3000", forwardedHost: "proxy.example.org", appUrl: null }).ok).toBe(true);
    expect(check({ origin: "https://app.example.com", host: "internal:3000" }).ok).toBe(true);
  });
  it("does not match a look-alike host", () => {
    expect(check({ origin: "https://app.example.com.evil.net" }).ok).toBe(false);
  });
  it("allows a request with neither header (not a browser)", () => {
    expect(check({}).ok).toBe(true);
  });
});
