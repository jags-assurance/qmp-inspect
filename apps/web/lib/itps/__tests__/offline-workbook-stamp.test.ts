import { describe, expect, it } from "vitest";
import { buildItpWorkbook, parseItpWorkbook, staleWorkbookError, type OfflineWorkbookStamp } from "../offline-workbook";

const stamp: OfflineWorkbookStamp = { itpId: "itp-1", revision: 2, itpUpdatedAt: "2026-10-01T00:00:00Z", contentToken: "abc", stampedAt: "2026-10-02T00:00:00Z" };
const sections = [{ sectionNumber: 1, title: "General", items: [{ itemNumber: "1.1", activity: "Check", acceptanceCriteria: "ok", evidenceType: 1 as const, disciplineCode: null }] }];

async function roundTrip(withStamp: boolean) {
  const wb = buildItpWorkbook({ itpNumber: "ITP-1", title: "T", revision: 2, stamp: withStamp ? stamp : undefined }, sections);
  const buf = await wb.xlsx.writeBuffer();
  return parseItpWorkbook(buf as ArrayBuffer);
}

describe("offline workbook revision stamp (D11)", () => {
  it("carries the stamp through a download/upload round trip without disturbing the rows", async () => {
    const res = await roundTrip(true);
    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(1);
    expect(res.stamp).toEqual(stamp);
  });
  it("has no stamp when none was written (older downloads)", async () => {
    expect((await roundTrip(false)).stamp).toBeNull();
  });
  const current = { itpId: "itp-1", revision: 2, contentToken: "abc" };
  it("accepts a file taken from the current revision and content", () => {
    expect(staleWorkbookError(stamp, current)).toBeNull();
    expect(staleWorkbookError(null, current)).toBeNull();
  });
  it("refuses a file older than the ITP's current revision", () => {
    expect(staleWorkbookError(stamp, { ...current, revision: 3 })).toMatch(/out of date.*revision 2.*revision 3/);
  });
  it("refuses a file when the ITP content changed after download", () => {
    expect(staleWorkbookError(stamp, { ...current, contentToken: "zzz" })).toMatch(/edited after you downloaded/);
    expect(staleWorkbookError(stamp, { ...current, contentToken: null })).toBeNull();
  });
  it("refuses a workbook from another ITP", () => {
    expect(staleWorkbookError(stamp, { ...current, itpId: "other" })).toMatch(/different ITP/);
  });
});
