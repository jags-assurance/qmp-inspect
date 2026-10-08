import { describe, expect, it } from "vitest";
import { LATEST_RELEASE, RELEASES } from "../notes";

describe("release notes", () => {
  it("lists at least one release, newest first, each with dated, non-empty sections", () => {
    expect(RELEASES.length).toBeGreaterThan(0);
    expect(LATEST_RELEASE).toBe(RELEASES[0]);
    const dates = RELEASES.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const r of RELEASES) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.sections.length).toBeGreaterThan(0);
      for (const s of r.sections) expect(s.items.length).toBeGreaterThan(0);
    }
  });
});
