import { describe, expect, it } from "vitest";
import { csvCell, detectPunchImage, isPunchOverdue, validDueDate } from "../helpers";

describe("validDueDate", () => {
  it("accepts empty and real dates", () => {
    expect(validDueDate("")).toBe(true);
    expect(validDueDate("2026-02-28")).toBe(true);
    expect(validDueDate("2028-02-29")).toBe(true);
  });
  it("rejects impossible calendar dates and bad formats", () => {
    expect(validDueDate("2026-02-31")).toBe(false);
    expect(validDueDate("2026-02-29")).toBe(false);
    expect(validDueDate("2026-13-01")).toBe(false);
    expect(validDueDate("26-01-01")).toBe(false);
  });
});

describe("isPunchOverdue", () => {
  const now = new Date("2026-10-07T23:30:00Z");
  it("is overdue only when strictly before today (UTC) and not closed", () => {
    expect(isPunchOverdue({ due_date: "2026-10-06", status: "open" }, now)).toBe(true);
    expect(isPunchOverdue({ due_date: "2026-10-07", status: "open" }, now)).toBe(false);
    expect(isPunchOverdue({ due_date: "2026-10-06", status: "resolved" }, now)).toBe(true);
    expect(isPunchOverdue({ due_date: "2026-10-06", status: "closed" }, now)).toBe(false);
    expect(isPunchOverdue({ due_date: null, status: "open" }, now)).toBe(false);
  });
});

describe("detectPunchImage", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  it("accepts a JPEG whose bytes and extension agree", () => {
    expect(detectPunchImage(jpeg, "a.JPG")).toEqual({ ext: "jpg", contentType: "image/jpeg" });
  });
  it("rejects svg and mismatched content", () => {
    expect(detectPunchImage(new TextEncoder().encode("<svg xmlns='x'></svg>"), "a.svg")).toBeNull();
    expect(detectPunchImage(new TextEncoder().encode("<svg xmlns='x'></svg>"), "a.jpg")).toBeNull();
    expect(detectPunchImage(jpeg, "a.png")).toBeNull();
  });
  it("accepts PNG and HEIC signatures", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(detectPunchImage(png, "x.png")?.contentType).toBe("image/png");
    const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    expect(detectPunchImage(heic, "x.heic")?.contentType).toBe("image/heic");
  });
});

describe("csvCell", () => {
  it("neutralises formulas and escapes quotes", () => {
    expect(csvCell("=1+1")).toBe("\"'=1+1\"");
    expect(csvCell('a "b"')).toBe('"a ""b"""');
  });
});

import { csvLine, utcToday } from "../helpers";

describe("punch helper gaps", () => {
  it("treats a due date with a time part as date-only and never overdue when closed or undated", () => {
    const now = new Date("2026-10-07T23:59:59Z");
    expect(utcToday(now)).toBe("2026-10-07");
    expect(isPunchOverdue({ due_date: "2026-10-07T00:00:00Z", status: "open" }, now)).toBe(false);
    expect(isPunchOverdue({ due_date: "2026-10-06", status: "open" }, now)).toBe(true);
    expect(isPunchOverdue({ due_date: "2026-10-06", status: "closed" }, now)).toBe(false);
    expect(isPunchOverdue({ due_date: null, status: "open" }, now)).toBe(false);
  });
  it("csvLine neutralises every formula prefix and handles null/number cells", () => {
    expect(csvLine(["=1+1", "+a", "-b", "@c", null, 5])).toBe(`"'=1+1","'+a","'-b","'@c","",\"5\"`);
  });
});
