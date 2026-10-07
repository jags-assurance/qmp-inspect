import { describe, expect, it } from "vitest";
import {
  assertBookWithinLimits,
  chunk,
  escapeHtml,
  fetchAllIn,
  fetchAllPages,
  normaliseOverrideItems,
  registerAsOf,
  stripGeneratedPrefix,
} from "../src/jobs/dataBookHelpers";
import { bookRevLabel, dataBookIssueLabel } from "../src/jobs/dataBookTemplate";
import { calibrationStatus } from "../src/jobs/registerStatus";

describe("fetchAllPages", () => {
  const makeBuilder = (total: number) => async (from: number, to: number) => ({
    data: Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => from + i),
    error: null,
  });
  it("reads past the 1000-row cap", async () => {
    const rows = await fetchAllPages<number>("t", makeBuilder(2500));
    expect(rows).toHaveLength(2500);
  });
  it("handles an exact page multiple", async () => {
    expect(await fetchAllPages<number>("t", makeBuilder(2000))).toHaveLength(2000);
  });
  it("throws when a page errors", async () => {
    await expect(fetchAllPages<number>("t", async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow(/boom/);
  });
  it("throws when the loop cannot finish", async () => {
    await expect(fetchAllPages<number>("t", makeBuilder(100), 10, 3)).rejects.toThrow(/did not finish/);
  });
});

describe("chunk / fetchAllIn", () => {
  it("chunks at 200", () => {
    expect(chunk(Array.from({ length: 450 }, (_, i) => i)).map((c) => c.length)).toEqual([200, 200, 50]);
  });
  it("queries once per chunk and concatenates", async () => {
    const seen: number[] = [];
    const ids = Array.from({ length: 450 }, (_, i) => String(i));
    const rows = await fetchAllIn<string>("t", ids, async (c) => {
      seen.push(c.length);
      return { data: c, error: null };
    });
    expect(seen).toEqual([200, 200, 50]);
    expect(rows).toHaveLength(450);
  });
});

describe("revision label and issue wording", () => {
  it("prints the real revision", () => {
    expect(bookRevLabel({ bookRevision: 3 })).toBe("Rev 3");
    expect(bookRevLabel({})).toBe("Rev 0");
  });
  it("labels by status and conditional flag", () => {
    expect(dataBookIssueLabel("issued", false)).toBe("FINAL");
    expect(dataBookIssueLabel("issued", true)).toBe("FINAL — CONDITIONAL HANDOVER");
    expect(dataBookIssueLabel("issued", false, true)).toBe("FINAL — REPRINT");
    expect(dataBookIssueLabel("compiled")).toMatch(/REVIEW/);
    expect(dataBookIssueLabel("draft")).toMatch(/DRAFT/);
  });
});

describe("normaliseOverrideItems", () => {
  it("handles null / junk", () => {
    expect(normaliseOverrideItems(null)).toEqual([]);
    expect(normaliseOverrideItems({ a: 1 })).toEqual([]);
    expect(normaliseOverrideItems([null, 5, "x"])).toEqual([]);
  });
  it("maps the old punch-only shape", () => {
    const out = normaliseOverrideItems([
      { id: "1", description: "Paint touch-up", location: "Bay 2", due_date: "2026-11-01", responsible_party_name: "ACME" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("punch");
    expect(out[0].count).toBe(1);
    expect(out[0].items[0]).toContain("Paint touch-up");
    expect(out[0].items[0]).toContain("Bay 2");
  });
  it("maps the new category shape, string or object items", () => {
    const out = normaliseOverrideItems([
      { category: "ncrs", label: "NCRs closed", count: 2, items: ["NCR-001", { description: "NCR-002" }] },
      { category: "calibration", label: "Calibration in date", count: 4 },
    ]);
    expect(out.map((c) => c.category)).toEqual(["ncrs", "calibration"]);
    expect(out[0].items).toEqual(["NCR-001", "NCR-002"]);
    expect(out[1]).toMatchObject({ count: 4, items: [] });
  });
  it("handles a mix of old and new entries", () => {
    const out = normaliseOverrideItems([{ category: "ncrs", label: "NCRs", count: 1 }, { description: "Punch A" }]);
    expect(out[0].category).toBe("punch");
    expect(out).toHaveLength(2);
  });
});

describe("issued-date helpers", () => {
  it("evaluates register expiry at the issue date, not now", () => {
    const asOf = registerAsOf("2026-01-10");
    expect(asOf.toISOString()).toBe("2026-01-10T00:00:00.000Z");
    expect(calibrationStatus("2026-02-01", registerAsOf("2026-01-10"))).toBe("soon");
    expect(calibrationStatus("2026-02-01", registerAsOf("2026-06-01"))).toBe("expired");
  });
  it("falls back to today when no date", () => {
    expect(registerAsOf(null, new Date("2026-05-05T13:00:00Z")).toISOString()).toBe("2026-05-05T00:00:00.000Z");
  });
});

describe("misc", () => {
  it("escapes html", () => expect(escapeHtml(`<a&"'>`)).toBe("&lt;a&amp;&quot;&#39;&gt;"));
  it("strips the generated prefix", () => expect(stripGeneratedPrefix("generated-documents:a/b.pdf")).toBe("a/b.pdf"));
  it("caps pages and bytes", () => {
    expect(assertBookWithinLimits(10, 100)).toBeNull();
    expect(assertBookWithinLimits(5000, 100)).toMatch(/page/);
    expect(assertBookWithinLimits(10, 999999999)).toMatch(/byte/);
  });
});
