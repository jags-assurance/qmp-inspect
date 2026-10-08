import type { NavItem } from "@/components/domain/app-shell";

export interface PaletteEntry {
  label: string;
  href: string;
  path: string;
}

/** Every real destination in the sidebar (leaves only) plus Ctrl+K-only `palette` extras, each with
 *  its group path for context ("Settings › Access & Roles › Staff Access"). */
export function flattenNavItems(items: NavItem[], trail: string[] = []): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (const item of items) {
    if (item.children && item.children.length > 0) {
      out.push(...flattenNavItems(item.children, [...trail, item.label]));
    } else {
      if (item.palette) out.push(...flattenNavItems(item.palette, [...trail, item.label]));
      out.push({ label: item.label, href: item.href, path: [...trail, item.label].join(" › ") });
    }
  }
  return out;
}

/** Same matching the palette uses: every whitespace-separated term must appear in the path. */
export function filterEntries(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return entries;
  return entries.filter((e) => terms.every((t) => e.path.toLowerCase().includes(t)));
}
