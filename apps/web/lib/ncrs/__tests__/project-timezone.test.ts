import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidTimeZone, resolveSiteTimeZone, siteToday } from "../site-date";
import { isOverdue } from "@/app/inspect/ncrs/is-overdue";
import { isPunchOverdue } from "@/lib/punch-list/helpers";
import { applyNcrFilters } from "../list-filters";
import { VAULT_MAX_UPLOAD_BYTES, vaultFileTooLargeMessage } from "@/lib/vault/limits";

// 2026-10-06 21:30 UTC = 2026-10-07 01:30 in Dubai (UTC+4) but still 2026-10-06 in UTC and New York.
const NIGHT = new Date("2026-10-06T21:30:00Z");

afterEach(() => vi.unstubAllEnvs());

describe("project timezone", () => {
  it("validates IANA zones through Intl", () => {
    expect(isValidTimeZone("Asia/Dubai")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });

  it("uses the project zone when valid, else the environment zone", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_TIMEZONE", "Asia/Dubai");
    expect(resolveSiteTimeZone("America/New_York")).toBe("America/New_York");
    expect(resolveSiteTimeZone(null)).toBe("Asia/Dubai");
    expect(resolveSiteTimeZone("garbage")).toBe("Asia/Dubai");
  });

  it("judges NCR overdue on the site day around midnight", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_TIMEZONE", "Asia/Dubai");
    const ncr = { due_date: "2026-10-06", status: "open" as const };
    expect(isOverdue(ncr, "Asia/Dubai", NIGHT)).toBe(true); // already the 7th in Dubai
    expect(isOverdue(ncr, "America/New_York", NIGHT)).toBe(false); // still the 6th in New York
    expect(isOverdue(ncr, null, NIGHT)).toBe(true); // unknown project zone: env zone (Dubai)
    expect(isOverdue({ ...ncr, status: "closed" }, "Asia/Dubai", NIGHT)).toBe(false);
  });

  it("judges punch overdue on the site day, UTC when no zone is known", () => {
    const item = { due_date: "2026-10-06", status: "open" };
    expect(isPunchOverdue(item, NIGHT, "Asia/Dubai")).toBe(true);
    expect(isPunchOverdue(item, NIGHT, "America/New_York")).toBe(false);
    expect(isPunchOverdue(item, NIGHT)).toBe(false); // UTC day is still the 6th
  });

  it("the overdue filter compares against the project's site day", () => {
    const lt = vi.fn();
    const q = { neq: () => q, lt: (...a: unknown[]) => (lt(...a), q) };
    applyNcrFilters(q, { overdue: "1" }, "u1", "UTC");
    expect(lt).toHaveBeenCalledWith("due_date", siteToday(new Date(), "UTC"));
  });
});

describe("vault upload limit (K16)", () => {
  it("allows 500 MB and explains the cap clearly", () => {
    expect(VAULT_MAX_UPLOAD_BYTES).toBe(500 * 1024 * 1024);
    const msg = vaultFileTooLargeMessage(600 * 1024 * 1024);
    expect(msg).toMatch(/500 MB/);
    expect(msg).toMatch(/600 MB/);
  });
});
