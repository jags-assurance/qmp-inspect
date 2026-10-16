"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "./app-shell";
import { useBreadcrumbTail } from "./breadcrumb-context";

// Sidebar items only: palette-only (Ctrl+K) shortcuts can share a link with a real item and must not name the page.
function flatten(items: NavItem[]): NavItem[] {
  return items.flatMap((i) => [i, ...flatten(i.children ?? [])]);
}

/**
 * Header trail: "QMP Inspect" (link to the dashboard) and, once you are inside a section, that section's
 * name taken from the sidebar item whose link is the longest match for the current page.
 */
export function HeaderBreadcrumb({ root, navItems }: { root: string; navItems: NavItem[] }) {
  const pathname = usePathname() ?? "";
  const tail = useBreadcrumbTail();
  const homeHref = pathname.startsWith("/platform") ? "/platform" : "/inspect";
  let best: NavItem | null = null;
  for (const item of flatten(navItems)) {
    if (!item.href || item.href === homeHref) continue;
    const prefixes = [item.href, ...(item.activePrefixes ?? [])];
    const hit = prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
    if (hit && (!best || item.href.length > best.href.length)) best = item;
  }
  const section = best ? (best.displayLabel ?? best.label) : null;
  // Phones show only the current location (root > section > record collapses to its last crumb) so the
  // title never fights the header tools for width; from sm the full trail is shown.
  const hasTrail = Boolean(section || tail);
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
      <Link
        href={homeHref}
        title={root}
        className={"shrink-0 items-center whitespace-nowrap rounded-sm font-medium hover:text-ink hover:underline [@media(pointer:coarse)]:min-h-11 " + (hasTrail ? "hidden sm:inline-flex" : "inline-flex text-ink")}
      >
        {root}
      </Link>
      {section && (
        <>
          <span aria-hidden="true" className="hidden text-border-strong sm:inline">/</span>
          <span title={section ?? undefined} className={tail ? "hidden shrink-0 sm:inline" : "truncate font-semibold text-ink"} aria-current={tail ? undefined : "page"}>{section}</span>
        </>
      )}
      {tail && (
        <>
          <span aria-hidden="true" className="hidden text-border-strong sm:inline">/</span>
          <span title={tail ?? undefined} className="doc-id truncate font-semibold text-ink" aria-current="page">{tail}</span>
        </>
      )}
    </nav>
  );
}
