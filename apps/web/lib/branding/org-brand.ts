import type { CSSProperties } from "react";

export interface OrgBrandColors {
  brand_primary_color: string | null;
  brand_accent_color: string | null;
  /** Optional 4-color combo (Microsoft/Gemini-style multi-color branding), on top of the plain
   *  primary/accent pair — see brand_multi_color_mode below. */
  brand_color_3?: string | null;
  brand_color_4?: string | null;
  /** When true AND both extra colors are set, callers that render a brand mark (e.g. the sidebar's
   *  "JA" badge) should use the 4-color combo instead of the plain single-accent-border look. */
  brand_multi_color_mode?: boolean;
}

/**
 * Builds the inline-style override for a page's org-branding wrapper. The app's burgundy/gold
 * theme is driven entirely by the `--color-burgundy`/`--color-gold` CSS custom properties defined
 * on :root in app/globals.css, and re-aliased for Tailwind utilities (bg-burgundy, text-gold, etc.)
 * via `@theme inline`. Because those utilities resolve through the custom property at render time
 * rather than being compiled to a fixed value, setting the same-named property on any ancestor
 * element overrides every burgundy/gold utility beneath it — no design-system change needed.
 * The two extra combo colors (--brand-color-3/4) have no existing Tailwind alias — they're only
 * consumed directly by components that opt into the 4-color combo look (see brandComboColors below).
 *
 * Returns {} (no override) when both colors are null, so the page falls back to the default
 * palette exactly as if this wrapper weren't there.
 */
export function orgBrandStyle(colors: OrgBrandColors | null | undefined): CSSProperties {
  const style: Record<string, string> = {};
  if (colors?.brand_primary_color) {
    style["--color-burgundy"] = colors.brand_primary_color;
  }
  if (colors?.brand_accent_color) {
    style["--color-gold"] = colors.brand_accent_color;
  }
  if (colors?.brand_color_3) {
    style["--brand-color-3"] = colors.brand_color_3;
  }
  if (colors?.brand_color_4) {
    style["--brand-color-4"] = colors.brand_color_4;
  }
  return style as CSSProperties;
}

/** The 4 colors to use for a multi-color brand mark, in a fixed order — or null when the org hasn't
 *  opted into combo mode (missing/false flag, or either extra color unset), so callers can fall back
 *  to their existing single-accent-color rendering with one check. */
export function brandComboColors(colors: OrgBrandColors | null | undefined): [string, string, string, string] | null {
  if (!colors?.brand_multi_color_mode) return null;
  const { brand_primary_color: primary, brand_accent_color: accent, brand_color_3: c3, brand_color_4: c4 } = colors;
  if (!primary || !accent || !c3 || !c4) return null;
  return [primary, accent, c3, c4];
}
