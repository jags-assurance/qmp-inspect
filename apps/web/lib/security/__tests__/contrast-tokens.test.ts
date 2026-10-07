import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the WCAG contrast of the design tokens in app/globals.css so a later "lighten the borders"
// tweak can't silently put form controls back under the 3:1 non-text threshold.
const css = readFileSync(join(__dirname, "../../../app/globals.css"), "utf8");

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token ${name} not found`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("design token contrast", () => {
  it("control borders are at least 3:1 on white and off-white", () => {
    expect(ratio(token("color-control-border"), "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(ratio(token("color-control-border"), token("color-off-white"))).toBeGreaterThanOrEqual(3);
  });
  it("status text colours are at least 4.5:1 on white and off-white", () => {
    for (const name of ["color-success", "color-danger", "color-warning", "color-info", "color-muted"]) {
      expect(ratio(token(name), "#ffffff"), name).toBeGreaterThanOrEqual(4.5);
      expect(ratio(token(name), token("color-off-white")), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});
