import { describe, expect, it } from "vitest";
import {
  auditCsvCell,
  auditCsvHeaderLine,
  auditCsvLine,
  auditExportFilename,
  auditRowToCsvCells,
  describeAuditFilters,
  iterateAuditPages,
  parseAuditExportFilters,
  type AuditExportRow,
} from "../export";

const row = (over: Partial<AuditExportRow> = {}): AuditExportRow => ({
  id: "1",
  entity_type: "ncr",
  entity_id: "ncr-1",
  action: "closed",
  summary: "NCR closed",
  changes: null,
  created_at: "2026-03-04T05:06:07.890Z",
  actor_id: "u1",
  actor: { full_name: "Ada Lovelace", email: "ada@x.test" },
  ...over,
});

describe("auditCsvCell", () => {
  it("leaves plain text alone and handles null/undefined", () => {
    expect(auditCsvCell("hello")).toBe("hello");
    expect(auditCsvCell(null)).toBe("");
    expect(auditCsvCell(undefined)).toBe("");
  });
  it("quotes cells with commas, quotes and line breaks, doubling quotes", () => {
    expect(auditCsvCell("a,b")).toBe('"a,b"');
    expect(auditCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(auditCsvCell("l1\nl2")).toBe('"l1\nl2"');
    expect(auditCsvCell("l1\r\nl2")).toBe('"l1\r\nl2"');
  });
  it.each(["=SUM(A1)", "+1+1", "-2", "@cmd", "\tx", "\rx"])("neutralises formula starter %j", (v) => {
    const out = auditCsvCell(v);
    expect(out.replace(/^"/, "").startsWith("'")).toBe(true);
  });
  it("prefixes before quoting when the cell also needs quotes", () => {
    expect(auditCsvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });
  it("does not touch a formula character that is not leading", () => {
    expect(auditCsvCell("a=b")).toBe("a=b");
    expect(auditCsvCell("x-1")).toBe("x-1");
  });
});

describe("row mapping", () => {
  it("maps a row to the documented columns in UTC", () => {
    expect(auditRowToCsvCells(row({ changes: { from: "open", to: "closed" } }))).toEqual([
      "2026-03-04 05:06:07",
      "Ada Lovelace",
      "ada@x.test",
      "ncr",
      "ncr-1",
      "closed",
      "NCR closed",
      '{"from":"open","to":"closed"}',
    ]);
  });
  it("labels a missing actor as System and an unresolvable one as Unknown user", () => {
    expect(auditRowToCsvCells(row({ actor_id: null, actor: null }))[1]).toBe("System");
    expect(auditRowToCsvCells(row({ actor_id: "gone", actor: null }))[1]).toBe("Unknown user");
  });
  it("produces a CRLF-terminated line with the header matching the cell count", () => {
    const header = auditCsvHeaderLine();
    expect(header.endsWith("\r\n")).toBe(true);
    expect(header.trim().split(",").length).toBe(auditRowToCsvCells(row()).length);
    expect(auditCsvLine(["a", "b,c"])).toBe('a,"b,c"\r\n');
  });
  it("escapes hostile summaries end to end", () => {
    const line = auditCsvLine(auditRowToCsvCells(row({ summary: "=cmd|' /C calc'!A0" })));
    expect(line).toContain(",'=cmd|' /C calc'!A0,");
  });
});

describe("parseAuditExportFilters", () => {
  const now = new Date("2026-06-30T00:00:00.000Z");
  it("defaults to the page's 30 day range and accepts all", () => {
    expect(parseAuditExportFilters({}, now).fromIso).toBe("2026-05-31T00:00:00.000Z");
    expect(parseAuditExportFilters({ range: "all" }, now).fromIso).toBeNull();
    expect(parseAuditExportFilters({ range: "bogus" }, now).fromIso).toBe("2026-05-31T00:00:00.000Z");
  });
  it("accepts well-formed cat/actor and drops anything else", () => {
    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    expect(parseAuditExportFilters({ cat: "ncr", actor: uuid }, now)).toMatchObject({ cat: "ncr", actor: uuid });
    expect(parseAuditExportFilters({ cat: "a,b)", actor: "not-a-uuid" }, now)).toMatchObject({ cat: null, actor: null });
  });
  it("describes the filters", () => {
    expect(describeAuditFilters({ fromIso: null, cat: null, actor: null })).toBe("all recorded events");
    expect(describeAuditFilters({ fromIso: "2026-05-31T00:00:00.000Z", cat: "ncr", actor: "u" }, "Ada")).toBe(
      "events since 2026-05-31; category: ncr; person: Ada"
    );
  });
});

describe("iterateAuditPages", () => {
  const make = (n: number) => Array.from({ length: n }, (_, i) => row({ id: String(i) }));
  async function collect(total: number, pageSize: number) {
    const all = make(total);
    const calls: [number, number][] = [];
    const out: AuditExportRow[] = [];
    for await (const p of iterateAuditPages(async (from, to) => {
      calls.push([from, to]);
      return all.slice(from, to + 1);
    }, pageSize))
      out.push(...p);
    return { out, calls };
  }
  it("returns every row across pages with no cap", async () => {
    const { out, calls } = await collect(2503, 1000);
    expect(out).toHaveLength(2503);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("asks for one more page when the total is an exact multiple, then stops", async () => {
    const { out, calls } = await collect(2000, 1000);
    expect(out).toHaveLength(2000);
    expect(calls).toHaveLength(3);
  });
  it("yields nothing for an empty log and propagates fetch errors", async () => {
    expect((await collect(0, 1000)).out).toEqual([]);
    const it = iterateAuditPages(async () => {
      throw new Error("boom");
    });
    await expect(it.next()).rejects.toThrow("boom");
  });
});

describe("auditExportFilename", () => {
  it("sanitises the project number", () => {
    expect(auditExportFilename("P/001 x", "csv", new Date("2026-01-02T00:00:00Z"))).toBe("audit-log-P_001_x-2026-01-02.csv");
  });
});
