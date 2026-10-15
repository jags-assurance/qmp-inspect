import Link from "next/link";
import { cn } from "@/lib/cn";

export interface FilterChip {
  key: string;
  label: string;
  /** Optional count shown after the label. */
  count?: number;
  href: string;
  active?: boolean;
}

/**
 * Quick-filter chips (status tabs such as All / Open / Overdue). Each chip is a real link, so it
 * works with no JavaScript and is server-component safe. On phones the row scrolls sideways on one
 * line (no wrapping tower of pills); from sm it wraps. The active chip carries a check mark and
 * aria-current, so it is not signalled by colour alone. 44px tall on touch screens.
 */
export function FilterChips({ items, label, className }: { items: FilterChip[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("-mx-3 overflow-x-auto px-3 scrollbar-none sm:mx-0 sm:overflow-visible sm:px-0", className)}>
      <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
        {items.map((c) => (
          <li key={c.key}>
            <Link
              href={c.href}
              prefetch={false}
              aria-current={c.active ? "true" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors [@media(pointer:coarse)]:min-h-11",
                c.active ? "border-brand bg-brand text-white" : "border-control-border bg-surface text-ink hover:bg-surface-subtle"
              )}
            >
              {c.active && (
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M4.5 10.5l3.5 3.5 7.5-8" />
                </svg>
              )}
              {c.label}
              {c.count !== undefined && (
                <span className={cn("text-xs tabular-nums", c.active ? "text-white/85" : "text-muted")}>{c.count}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
