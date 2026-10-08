import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { fetchCountedRegisterRows } from "../readiness";

describe("fetchCountedRegisterRows (E2)", () => {
  it("ignores unverified and superseded/retired/withdrawn register rows", async () => {
    const rows = [
      { id: "ok", verified_at: "2026-10-01T00:00:00Z", lifecycle_status: "active" },
      { id: "unverified", verified_at: null, lifecycle_status: "active" },
      { id: "superseded", verified_at: "2026-10-01T00:00:00Z", lifecycle_status: "superseded" },
      { id: "retired", verified_at: "2026-10-01T00:00:00Z", lifecycle_status: "retired" },
      { id: "withdrawn", verified_at: "2026-10-01T00:00:00Z", lifecycle_status: "withdrawn" },
    ];
    const out = await fetchCountedRegisterRows<{ id: string }>("id", async (select) => {
      expect(select).toContain("verified_at");
      return { data: rows, error: null };
    });
    expect(out.map((r) => r.id)).toEqual(["ok"]);
  });

  it("falls back to the plain columns (all rows trusted) before the verification migration is applied", async () => {
    const selects: string[] = [];
    const out = await fetchCountedRegisterRows<{ id: string }>("id", async (select) => {
      selects.push(select);
      if (select.includes("verified_at")) return { data: null, error: { message: "column calibration_register.verified_at does not exist" } };
      return { data: [{ id: "a" }, { id: "b" }], error: null };
    });
    expect(selects).toHaveLength(2);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("still throws on an unrelated read failure (never reads as 'no rows')", async () => {
    await expect(fetchCountedRegisterRows("id", async () => ({ data: null, error: { message: "timeout" } }))).rejects.toThrow(/timeout/);
  });
});
