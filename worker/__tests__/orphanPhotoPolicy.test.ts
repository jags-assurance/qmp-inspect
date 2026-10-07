import { describe, expect, it } from "vitest";
import { countByOrganisation, orphanCutoffIso, ORPHAN_MIN_AGE_MS, ORPHAN_SWEEP_INTERVAL_MS, shouldRunOrphanSweep } from "../src/orphanPhotoPolicy";

describe("orphanCutoffIso", () => {
  it("is seven days before now", () => {
    const now = Date.UTC(2026, 9, 20, 12, 0, 0);
    expect(new Date(orphanCutoffIso(now)).getTime()).toBe(now - ORPHAN_MIN_AGE_MS);
  });
});

describe("shouldRunOrphanSweep", () => {
  it("runs first time and then at most once a day", () => {
    const now = 1_000_000_000_000;
    expect(shouldRunOrphanSweep(null, now)).toBe(true);
    expect(shouldRunOrphanSweep(now - 1000, now)).toBe(false);
    expect(shouldRunOrphanSweep(now - ORPHAN_SWEEP_INTERVAL_MS, now)).toBe(true);
  });
});

describe("countByOrganisation", () => {
  it("counts per organisation", () => {
    const m = countByOrganisation([
      { storage_path: "a", organization_id: "o1", size_bytes: 1 },
      { storage_path: "b", organization_id: "o1", size_bytes: null },
      { storage_path: "c", organization_id: "o2", size_bytes: 3 },
    ]);
    expect(m.get("o1")).toBe(2);
    expect(m.get("o2")).toBe(1);
  });
});
