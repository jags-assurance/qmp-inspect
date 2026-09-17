import type { CSSProperties } from "react";

export interface OrgBrandColors {
  brand_primary_color: string | null;
  brand_accent_color: string | null;
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
