import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translateText } from "../dictionary";

// The AR map is not exported, so read the source: this also catches duplicate keys, which a plain
// object literal silently collapses.
const source = readFileSync(join(__dirname, "..", "dictionary.ts"), "utf8");
const body = source.slice(source.indexOf("const AR"), source.indexOf("const DICTIONARIES"));
const entries = [...body.matchAll(/^\s{2}(?:"((?:[^"\\]|\\.)*)"|([A-Za-z]\w*)):\s*(?:\n\s*)?"((?:[^"\\]|\\.)*)",\s*$/gm)].map((m) => ({
  key: (m[1] ?? m[2]) as string,
  value: m[3] as string,
}));

describe("Arabic dictionary integrity", () => {
  it("parses a plausible number of entries", () => {
    expect(entries.length).toBeGreaterThan(150);
  });
  it("has no empty keys or values", () => {
    for (const e of entries) {
      expect(e.key.trim(), "key").not.toBe("");
      expect(e.value.trim(), e.key).not.toBe("");
    }
  });
  it("has no duplicate keys", () => {
    const seen = new Set<string>();
    for (const e of entries) {
      expect(seen.has(e.key), `duplicate key ${e.key}`).toBe(false);
      seen.add(e.key);
    }
  });
  it("preserves {placeholders}", () => {
    const ph = (t: string) => (t.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const e of entries) expect(ph(e.value), e.key).toBe(ph(e.key));
  });
  it("translates every parsed key for ar and never alters English", () => {
    for (const e of entries) {
      expect(translateText("ar", e.key)).toBe(e.value.replace(/\\"/g, '"'));
      expect(translateText("en", e.key)).toBe(e.key);
    }
  });
});
