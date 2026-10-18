"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Tx } from "@/components/domain/tx";
import type { NavItem } from "./app-shell";

/**
 * "Related pages" strip: the list pages that belong to one job sit together, so a person moves
 * between them in one tap without hunting through the sidebar. It shows only on those list pages
 * (never on a record's own page) and only offers pages the signed-in user can already open: an item
 * appears when its link is in that user's own sidebar / page search (or is always available).
 */
const GROUPS: { label: string; items: { label: string; href: string; always?: boolean }[] }[] = [
  {
    label: "Issues",
    items: [
      { label: "NCRs", href: "/inspect/ncrs" },
      { label: "Issues", href: "/inspect/observations" },
      { label: "Vendor scorecard", href: "/inspect/ncrs/scorecard", always: true },
    ],
  },
  {
    label: "Site work",
    items: [
      { label: "Start work", href: "/inspect/start-work" },
      { label: "Inspections", href: "/inspect/inspections" },
      { label: "Standalone assignments", href: "/inspect/standalone" },
    ],
  },
  {
    label: "Documents",
    items: [
      { label: "Reports & Documents", href: "/inspect/reports-documents" },
      { label: "Document Vault", href: "/inspect/vault" },
      { label: "Data Book / Handover", href: "/inspect/handover" },
    ],
  },
  {
    label: "Plan",
    items: [
      { label: "Projects", href: "/inspect/projects" },
      { label: "ITPs", href: "/inspect/itps" },
    ],
  },
];

function hrefsOf(items: NavItem[]): Set<string> {
  const out = new Set<string>();
  const walk = (list: NavItem[]) => {
    for (const i of list) {
      if (i.href) out.add(i.href);
      walk(i.children ?? []);
      walk(i.palette ?? []);
    }
  };
  walk(items);
  return out;
}

export function RelatedPages({ navItems }: { navItems: NavItem[] }) {
  const pathname = (usePathname() ?? "").replace(/\/$/, "");
  const group = GROUPS.find((g) => g.items.some((i) => i.href === pathname));
  if (!group) return null;
  const allowed = hrefsOf(navItems);
  const items = group.items.filter((i) => i.always || allowed.has(i.href));
  if (items.length < 2) return null;

  return (
    <nav aria-label={group.label} className="no-print mb-4 flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted"><Tx>{group.label}</Tx></span>
      <ul className="flex gap-2">
        {items.map((i) => {
          const active = i.href === pathname;
          return (
            <li key={i.href} className="shrink-0">
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors [@media(pointer:coarse)]:min-h-11",
                  active ? "border-brand bg-brand text-white" : "border-control-border bg-surface text-ink hover:bg-surface-subtle"
                )}
              >
                <Tx>{i.label}</Tx>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
