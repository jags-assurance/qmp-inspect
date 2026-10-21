import { describe, expect, it, vi } from "vitest";
import { runSignoffAutomationSweep, signoffSweepConfig } from "../src/signoffSweepClient";

describe("signoffSweepConfig", () => {
  it("needs both the app URL and the secret", () => {
    expect(signoffSweepConfig({ PUBLIC_APP_URL: "https://x.test" } as never)).toBeNull();
    expect(signoffSweepConfig({ CRON_SECRET: "s" } as never)).toBeNull();
    expect(signoffSweepConfig({ PUBLIC_APP_URL: "not-a-url", CRON_SECRET: "s" } as never)).toBeNull();
  });
  it("trims trailing slashes and falls back to NEXT_PUBLIC_APP_URL", () => {
    expect(signoffSweepConfig({ NEXT_PUBLIC_APP_URL: "https://x.test//", CRON_SECRET: "s" } as never)).toEqual({ baseUrl: "https://x.test", secret: "s" });
  });
});

describe("runSignoffAutomationSweep", () => {
  it("does nothing when not configured", async () => {
    const f = vi.fn();
    expect(await runSignoffAutomationSweep(f as never, {} as never)).toEqual({ ran: false });
    expect(f).not.toHaveBeenCalled();
  });
  it("calls the sweep route with the bearer secret", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const r = await runSignoffAutomationSweep(f as never, { PUBLIC_APP_URL: "https://x.test", CRON_SECRET: "sec" } as never);
    expect(r).toEqual({ ran: true, status: 200 });
    expect(f).toHaveBeenCalledWith("https://x.test/api/cron/signoff-automation", expect.objectContaining({ headers: { authorization: "Bearer sec" } }));
  });
  it("throws on a non-2xx answer so the failure is reported", async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(runSignoffAutomationSweep(f as never, { PUBLIC_APP_URL: "https://x.test", CRON_SECRET: "sec" } as never)).rejects.toThrow("HTTP 401");
  });
});
