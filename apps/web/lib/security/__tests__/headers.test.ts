import { describe, expect, it } from "vitest";
import { buildCsp, securityHeaders } from "../headers";

describe("security headers", () => {
  it("forbids framing and sets nosniff / referrer policy", () => {
    const h = securityHeaders({ supabaseUrl: "https://x.supabase.co", isProduction: false });
    const get = (k: string) => h.find((e) => e.key === k)?.value;
    expect(get("X-Frame-Options")).toBe("DENY");
    expect(get("X-Content-Type-Options")).toBe("nosniff");
    expect(get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(get("Strict-Transport-Security")).toBeUndefined();
    expect(get("Content-Security-Policy-Report-Only")).toContain("frame-ancestors 'none'");
  });
  it("adds HSTS only in production", () => {
    expect(securityHeaders({ isProduction: true }).some((e) => e.key === "Strict-Transport-Security")).toBe(true);
  });
  it("allows the Supabase origin for connections and websockets", () => {
    const csp = buildCsp("https://abc.supabase.co");
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co");
  });
});
