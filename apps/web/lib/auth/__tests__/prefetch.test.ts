import { describe, expect, it } from "vitest";
import { isPrefetchRequest } from "../prefetch";

const h = (init: Record<string, string>) => new Headers(init);

describe("isPrefetchRequest", () => {
  it("recognises the Next router prefetch header", () => {
    expect(isPrefetchRequest(h({ "next-router-prefetch": "1" }))).toBe(true);
  });
  it("recognises the browser purpose headers", () => {
    expect(isPrefetchRequest(h({ purpose: "prefetch" }))).toBe(true);
    expect(isPrefetchRequest(h({ "sec-purpose": "prefetch;anonymous-client-ip" }))).toBe(true);
  });
  it("is false for a normal navigation", () => {
    expect(isPrefetchRequest(h({}))).toBe(false);
    expect(isPrefetchRequest(h({ "next-router-prefetch": "0" }))).toBe(false);
  });
});
