import { describe, expect, it } from "vitest";
import { isPublicPath } from "../public-paths";

describe("signed-out allow list", () => {
  it("keeps the existing public routes", () => {
    for (const p of ["/login", "/login/mfa", "/forgot-password", "/reset-password", "/auth/confirm", "/verify/irn/abc", "/api/health", "/api/vault/email-inbound", "/sw.js", "/manifest.webmanifest", "/offline.html"]) {
      expect(isPublicPath(p), p).toBe(true);
    }
  });

  it("allows the privacy notice and terms of use, with or without a trailing slash", () => {
    expect(isPublicPath("/privacy")).toBe(true);
    expect(isPublicPath("/privacy/")).toBe(true);
    expect(isPublicPath("/terms")).toBe(true);
  });

  it("does not widen to look-alike or nested paths", () => {
    for (const p of ["/privacy-admin", "/privacy/edit", "/terms/accept", "/termsx", "/inspect/privacy", "/inspect/terms", "/inspect/support", "/inspect/whats-new"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });

  it("keeps the app itself private", () => {
    for (const p of ["/", "/inspect", "/inspect/projects", "/platform", "/api/offline-sync", "/api/registers/export"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
});
