import { describe, expect, it } from "vitest";
import { MAX_BULK_ACCOUNTS, parseEmailList } from "../bulk-emails";

describe("parseEmailList", () => {
  it("splits on newlines, commas, semicolons and spaces, lower-cases and de-duplicates", () => {
    const r = parseEmailList("A@x.com, b@x.com;\nc@x.com  a@X.com");
    expect(r.emails).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    expect(r.invalid).toEqual([]);
    expect(r.truncated).toBe(false);
  });
  it("reports invalid entries separately", () => {
    const r = parseEmailList("ok@x.com not-an-email @x.com");
    expect(r.emails).toEqual(["ok@x.com"]);
    expect(r.invalid).toEqual(["not-an-email", "@x.com"]);
  });
  it("handles angle brackets from a mail client", () => {
    expect(parseEmailList("<a@x.com>").emails).toEqual(["a@x.com"]);
  });
  it("flags more than the maximum", () => {
    const many = Array.from({ length: MAX_BULK_ACCOUNTS + 1 }, (_, i) => `u${i}@x.com`).join("\n");
    const r = parseEmailList(many);
    expect(r.truncated).toBe(true);
    expect(r.emails).toHaveLength(MAX_BULK_ACCOUNTS);
  });
  it("returns nothing for empty input", () => {
    expect(parseEmailList("  \n ").emails).toEqual([]);
  });
});
