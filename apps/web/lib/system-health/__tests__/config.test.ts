import { describe, expect, it } from "vitest";
import { computeConfigHealth, startupWarning, workerHeartbeat } from "../config";

describe("system health config", () => {
  it("reports OFF for everything on an empty env and never echoes values", () => {
    const f = computeConfigHealth({});
    expect(f.every((x) => !x.on)).toBe(true);
    const f2 = computeConfigHealth({ RESEND_API_KEY: "re_secret_123", NOTIFICATIONS_EMAIL_FROM: "a@b.com", SENTRY_DSN: "https://k@s.io/1" });
    expect(JSON.stringify(f2)).not.toContain("re_secret_123");
    expect(JSON.stringify(f2)).not.toContain("https://k@s.io");
    expect(f2.find((x) => x.key === "email")?.on).toBe(true);
  });
  it("needs both AI key and tier", () => {
    expect(computeConfigHealth({ GEMINI_API_KEY: "k" }).find((x) => x.key === "ai")?.on).toBe(false);
    expect(computeConfigHealth({ GEMINI_API_KEY: "k", AI_TIER: "free" }).find((x) => x.key === "ai")?.on).toBe(true);
  });
  it("warns on the Resend test sender", () => {
    const f = computeConfigHealth({ RESEND_API_KEY: "k", NOTIFICATIONS_EMAIL_FROM: "Me <onboarding@resend.dev>" });
    expect(f.find((x) => x.key === "email")?.warning).toBeTruthy();
  });
  it("startup warning lists disabled features, null when all on", () => {
    expect(startupWarning({})).toContain("Email sending");
    const all = { RESEND_API_KEY: "k", NOTIFICATIONS_EMAIL_FROM: "a@b.com", NEXT_PUBLIC_APP_URL: "https://x", SENTRY_DSN: "d", GEMINI_API_KEY: "g", AI_TIER: "paid" };
    expect(startupWarning(all)).toBeNull();
  });
  it("heartbeat: unknown, ok, stale", () => {
    const now = Date.parse("2026-12-07T00:00:00Z");
    expect(workerHeartbeat([null], now).status).toBe("unknown");
    expect(workerHeartbeat(["2026-12-06T23:58:00Z"], now).status).toBe("ok");
    expect(workerHeartbeat(["2026-12-06T22:00:00Z", "2026-12-06T10:00:00Z"], now).status).toBe("stale");
  });
});
