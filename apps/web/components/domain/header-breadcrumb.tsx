"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "./app-shell";
import { useBreadcrumbTail } from "./breadcrumb-context";

function flatten(items: NavItem[]): NavItem[] {
  return items.flatMap((i) => [i, ...flatten(i.children ?? []), ...flatten(i.palette ?? [])]);
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
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
      <Link href={homeHref} className="shrink-0 hover:text-ink hover:underline">
        {root}
      </Link>
      {section && (
        <>
          <span aria-hidden="true">›</span>
          <span className={tail ? "shrink-0" : "truncate font-medium text-ink"}>{section}</span>
        </>
      )}
      {tail && (
        <>
          <span aria-hidden="true">›</span>
          <span className="doc-id truncate font-medium text-ink">{tail}</span>
        </>
      )}
    </nav>
  );
}
