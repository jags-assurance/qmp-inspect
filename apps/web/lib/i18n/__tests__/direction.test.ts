import { describe, expect, it } from "vitest";
import { directionFor, htmlAttributesFor, isRtlLocale, normalizeLocale } from "../direction";

describe("direction", () => {
  it("treats Arabic and other RTL scripts as rtl, with or without a region", () => {
    for (const tag of ["ar", "ar-SA", "AR_eg", "he", "fa-IR", "ur"]) expect(isRtlLocale(tag)).toBe(true);
    expect(directionFor("ar-AE")).toBe("rtl");
  });

  it("keeps everything else LTR, including junk and empty input", () => {
    for (const tag of ["en", "en-GB", "zh-CN", "fr", "", null, undefined, "!!", "arabic"]) expect(isRtlLocale(tag)).toBe(false);
    expect(directionFor(undefined)).toBe("ltr");
  });

  it("normalises to a supported locale and defaults to English", () => {
    expect(normalizeLocale("ar-SA")).toBe("en");
    expect(normalizeLocale("EN-us")).toBe("en");
    expect(normalizeLocale("fr")).toBe("en");
    expect(normalizeLocale(null)).toBe("en");
  });

  it("builds the <html> attributes", () => {
    // Arabic is no longer offered: a stale cookie value falls back to English.
    expect(htmlAttributesFor("ar")).toEqual({ lang: "en", dir: "ltr" });
    expect(htmlAttributesFor(undefined)).toEqual({ lang: "en", dir: "ltr" });
    // A supported-but-unknown value never produces rtl on an English page.
    expect(htmlAttributesFor("he")).toEqual({ lang: "en", dir: "ltr" });
  });
});
