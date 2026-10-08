import { describe, expect, it } from "vitest";
import { isTranslationStale, mergeItpTranslation, parseItpTranslations } from "../translations";

const fr = { title: "Titre", scope: "Portée", translated_at: "2026-10-01T00:00:00Z", source_revision: 2 };

describe("itp translations", () => {
  it("parses only well-formed entries", () => {
    expect(parseItpTranslations(null)).toEqual({});
    expect(parseItpTranslations([1])).toEqual({});
    expect(parseItpTranslations({ French: fr, Bad: { scope: "x" }, Worse: 3 })).toEqual({ French: fr });
  });
  it("merges a language without dropping the others", () => {
    const merged = mergeItpTranslation({ French: fr }, "Spanish", { ...fr, title: "Título" });
    expect(Object.keys(merged).sort()).toEqual(["French", "Spanish"]);
    expect(mergeItpTranslation(merged, "French", { ...fr, title: "Nouveau" }).French.title).toBe("Nouveau");
  });
  it("flags a translation of an older revision as stale", () => {
    expect(isTranslationStale(fr, 2)).toBe(false);
    expect(isTranslationStale(fr, 3)).toBe(true);
  });
});
