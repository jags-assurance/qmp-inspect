import type { CSSProperties } from "react";

export interface OrgBrandColors {
  brand_primary_color: string | null;
  brand_accent_color: string | null;
  /** Any number of extra colors (0+) on top of the primary/accent pair — see brand_multi_color_mode
   *  below. Client feedback: a fixed 4-color combo wasn't enough — this is a plain array so an org
   *  can add or remove as many as it wants. */
  brand_extra_colors?: string[] | null;
  /** When true AND there's at least one extra color, callers that render a brand mark (e.g. the
   *  sidebar's "JA" badge) should use the full combo instead of the plain single-accent-border look. */
  brand_multi_color_mode?: boolean;
}

/**
 * Builds the inline-style override for a page's org-branding wrapper. The app's burgundy/gold
 * theme is driven entirely by the `--color-burgundy`/`--color-gold` CSS custom properties defined
 * on :root in app/globals.css, and re-aliased for Tailwind utilities (bg-burgundy, text-gold, etc.)
 * via `@theme inline`. Because those utilities resolve through the custom property at render time
 * rather than being compiled to a fixed value, setting the same-named property on any ancestor
 * element overrides every burgundy/gold utility beneath it — no design-system change needed.
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
  return style as CSSProperties;
}

/**
 * The colors to use for a multi-color brand mark, in order — or null when the org hasn't opted
 * into combo mode (missing/false flag, or no extra colors set beyond the plain primary/accent pair),
 * so callers can fall back to their existing single-accent-color rendering with one check. Any
 * length >= 3 is valid — there's no fixed color count.
 */
export function brandComboColors(colors: OrgBrandColors | null | undefined): string[] | null {
  if (!colors?.brand_multi_color_mode) return null;
  const { brand_primary_color: primary, brand_accent_color: accent, brand_extra_colors: extra } = colors;
  const extras = (extra ?? []).filter(Boolean);
  if (!primary || !accent || extras.length === 0) return null;
  return [primary, accent, ...extras];
}
