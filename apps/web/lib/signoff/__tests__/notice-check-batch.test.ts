import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNoticeCheck, getNoticeChecksForActivity } from "../notice-check";

// Minimal PostgREST stand-in: from(table).select(..).eq(col, val)... resolves to the rows matching
// every eq filter (rows carry every column either caller selects), or the first one for maybeSingle.
type Row = Record<string, unknown>;
function fakeClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const builder = {
        select: () => builder,
        returns: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return builder;
        },
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
      };
      return builder;
    },
  } as unknown as Parameters<typeof getNoticeCheck>[0];
}

const ctx = { itpItemId: "item-1", projectId: "proj-1", organizationId: "org-1" };
const item = (override: number | null) => ({
  id: "item-1",
  planned_date: "2026-06-15",
  notice_hours_override: override,
  itp_sections: { itps: { project_id: "proj-1", projects: { organization_id: "org-1" } } },
});
const tables = (override: number | null) => ({
  itp_items: [item(override)],
  activity_signoff_progress: [
    { itp_item_id: "item-1", intervention: "H" },
    { itp_item_id: "item-1", intervention: "W" },
    { itp_item_id: "item-1", intervention: "H" },
    { itp_item_id: "item-1", intervention: "R" },
    { itp_item_id: "other", intervention: "S" },
  ],
  notice_period_configs: [
    { project_id: "proj-1", intervention: "W", hours: 40 },
    { project_id: "proj-2", intervention: "H", hours: 1 },
  ],
  intervention_level_types: [
    { organization_id: "org-1", code: "H", label: "Hold point", default_notice_hours: 72 },
    { organization_id: "org-1", code: "W", label: "Witness point", default_notice_hours: 6 },
    { organization_id: "org-1", code: "R", label: "Review", default_notice_hours: null },
    { organization_id: "org-2", code: "R", label: "Other org", default_notice_hours: 1 },
  ],
  projects: [{ id: "proj-1", timezone: "Asia/Dubai" }],
});

describe("getNoticeChecksForActivity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T06:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  for (const override of [null, 30]) {
    it(`matches getNoticeCheck for every code on the activity (override ${override})`, async () => {
      const client = fakeClient(tables(override));
      const batched = await getNoticeChecksForActivity(client, ctx);
      const perCode = await Promise.all(["H", "W", "R"].map((code) => getNoticeCheck(client, "item-1", code)));
      expect(batched).toEqual(perCode);
    });
  }

  it("uses the same precedence: override, then project config, then the level default and its label", async () => {
    const [h, w, r] = await getNoticeChecksForActivity(fakeClient(tables(null)), ctx);
    expect(h.requiredHours).toBe(72);
    expect(h.message).toMatch(/^Hold point needs 72 h/);
    expect(w.requiredHours).toBe(40);
    expect(w.message).toMatch(/^Witness needs 40 h/);
    expect(r.requiredHours).toBe(24);
    expect(r.message).toMatch(/^Review needs 24 h/);
  });
});
