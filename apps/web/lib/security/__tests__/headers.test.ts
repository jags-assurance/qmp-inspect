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
    expect(get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(get("Content-Security-Policy-Report-Only")).toBeUndefined();
  });
  it("can fall back to report-only", () => {
    const h = securityHeaders({ supabaseUrl: "https://x.supabase.co", isProduction: true, enforceCsp: false });
    expect(h.find((e) => e.key === "Content-Security-Policy")).toBeUndefined();
    expect(h.find((e) => e.key === "Content-Security-Policy-Report-Only")?.value).toContain("unsafe-eval");
  });
  it("observes a stricter no-eval policy next to the enforced one in production", () => {
    const h = securityHeaders({ supabaseUrl: "https://x.supabase.co", isProduction: true });
    expect(h.find((e) => e.key === "Content-Security-Policy")?.value).toContain("'unsafe-eval'");
    expect(h.find((e) => e.key === "Content-Security-Policy-Report-Only")?.value).not.toContain("unsafe-eval");
  });
  it("adds HSTS only in production", () => {
    expect(securityHeaders({ isProduction: true }).some((e) => e.key === "Strict-Transport-Security")).toBe(true);
  });
  it("allows the Supabase origin for connections and websockets", () => {
    const csp = buildCsp("https://abc.supabase.co");
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co");
  });
});
