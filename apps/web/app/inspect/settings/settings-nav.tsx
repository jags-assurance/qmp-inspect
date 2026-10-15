import Link from "next/link";
import { cn } from "@/lib/cn";
import { ScrollRow } from "./scroll-row";

export interface SettingsNavItem {
  key: string;
  label: string;
  /** Link-only items open their own page instead of rendering in the workspace. */
  href?: string;
}

export interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

function hrefFor(item: SettingsNavItem) {
  return item.href ?? `/inspect/settings?section=${item.key}`;
}

/**
 * Settings navigation. On lg+ a grouped left rail; on phone/tablet a sticky two-row bar (groups,
 * then the active group's sections) that scrolls sideways instead of wrapping. Plain links, so
 * every section is a shareable URL, and every target is 44px tall.
 */
export function SettingsNav({ groups, active }: { groups: SettingsNavGroup[]; active: string }) {
  const activeGroup = groups.find((g) => g.items.some((i) => i.key === active)) ?? groups[0];
  return (
    <>
      <nav
        aria-label="Settings sections"
        className="sticky top-[calc(var(--header-h)+env(safe-area-inset-top))] z-10 -mx-3 mt-4 border-b border-border-strong bg-background px-3 sm:-mx-6 sm:px-6 lg:hidden"
      >
        <ScrollRow className="flex snap-x gap-1 overflow-x-auto [scrollbar-width:thin]" label="Groups">
          {groups.map((g) => {
            const isActive = g === activeGroup;
            return (
              <li key={g.label} className="snap-start">
                <Link
                  href={hrefFor(g.items[0])}
                  scroll={false}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors",
                    isActive ? "border-burgundy text-burgundy" : "border-transparent text-muted hover:text-ink"
                  )}
                >
                  {g.label}
                </Link>
              </li>
            );
          })}
        </ScrollRow>
        <ScrollRow className="flex snap-x gap-1 overflow-x-auto border-t border-border py-1 [scrollbar-width:thin]" label={activeGroup.label}>
          {activeGroup.items.map((item) => {
            const isActive = item.key === active;
            return (
              <li key={item.key} className="snap-start">
                <Link
                  href={hrefFor(item)}
                  scroll={false}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-sm transition-colors",
                    isActive ? "bg-burgundy font-medium text-white" : "text-muted hover:bg-surface-subtle hover:text-ink"
                  )}
                >
                  {item.label}
                  {item.href ? <span aria-hidden="true"> ↗</span> : null}
                </Link>
              </li>
            );
          })}
        </ScrollRow>
      </nav>

      <nav aria-label="Settings sections" className="hidden lg:mt-6 lg:block lg:w-60 lg:shrink-0">
        <div className="sticky top-[calc(var(--header-h)+1rem)] max-h-[calc(100dvh-6rem)] space-y-5 overflow-y-auto pe-2">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted">{g.label}</p>
              <ul className="mt-1 space-y-0.5">
                {g.items.map((item) => {
                  const isActive = item.key === active;
                  return (
                    <li key={item.key}>
                      <Link
                        href={hrefFor(item)}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 items-center rounded-md px-3 text-sm transition-colors",
                          isActive ? "bg-burgundy/10 font-medium text-burgundy" : "text-ink hover:bg-surface-subtle"
                        )}
                      >
                        {item.label}
                        {item.href ? <span aria-hidden="true" className="ms-1 text-muted">↗</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading section">
      <div className="h-8 w-56 animate-pulse rounded bg-off-white" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-md bg-off-white" />
      ))}
    </div>
  );
}
