import { describe, expect, it } from "vitest";
import { brandComboColors, orgBrandStyle } from "../org-brand";

describe("orgBrandStyle", () => {
  it("returns no override when there is nothing to override", () => {
    expect(orgBrandStyle(null)).toEqual({});
    expect(orgBrandStyle(undefined)).toEqual({});
    expect(orgBrandStyle({ brand_primary_color: null, brand_accent_color: null })).toEqual({});
  });

  it("maps primary to --color-burgundy and accent to --color-gold independently", () => {
    expect(orgBrandStyle({ brand_primary_color: "#112233", brand_accent_color: null })).toEqual({ "--color-burgundy": "#112233" });
    expect(orgBrandStyle({ brand_primary_color: null, brand_accent_color: "#aabbcc" })).toEqual({ "--color-gold": "#aabbcc" });
    expect(orgBrandStyle({ brand_primary_color: "#112233", brand_accent_color: "#aabbcc" })).toEqual({
      "--color-burgundy": "#112233",
      "--color-gold": "#aabbcc",
    });
  });
});

describe("brandComboColors", () => {
  const base = { brand_primary_color: "#111111", brand_accent_color: "#222222" };

  it("is null unless combo mode is switched on", () => {
    expect(brandComboColors(null)).toBeNull();
    expect(brandComboColors({ ...base, brand_extra_colors: ["#333333"] })).toBeNull();
    expect(brandComboColors({ ...base, brand_extra_colors: ["#333333"], brand_multi_color_mode: false })).toBeNull();
  });

  it("is null when combo mode is on but there are no extras (falls back to single accent)", () => {
    expect(brandComboColors({ ...base, brand_multi_color_mode: true })).toBeNull();
    expect(brandComboColors({ ...base, brand_multi_color_mode: true, brand_extra_colors: [] })).toBeNull();
    expect(brandComboColors({ ...base, brand_multi_color_mode: true, brand_extra_colors: ["", ""] })).toBeNull();
  });

  it("is null when the primary/accent pair is incomplete", () => {
    expect(brandComboColors({ brand_primary_color: null, brand_accent_color: "#222222", brand_multi_color_mode: true, brand_extra_colors: ["#333333"] })).toBeNull();
    expect(brandComboColors({ brand_primary_color: "#111111", brand_accent_color: null, brand_multi_color_mode: true, brand_extra_colors: ["#333333"] })).toBeNull();
  });

  it("returns primary, accent, then every non-empty extra, in order, for any length", () => {
    expect(
      brandComboColors({ ...base, brand_multi_color_mode: true, brand_extra_colors: ["#333333", "", "#444444", "#555555"] })
    ).toEqual(["#111111", "#222222", "#333333", "#444444", "#555555"]);
  });
});
