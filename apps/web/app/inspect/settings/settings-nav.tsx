import Link from "next/link";
import { cn } from "@/lib/cn";

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
        className="sticky top-[57px] z-[5] -mx-3 mt-4 border-b border-border bg-background px-3 sm:-mx-4 sm:px-4 lg:hidden"
      >
        <ul className="flex snap-x gap-1 overflow-x-auto [scrollbar-width:thin]" aria-label="Groups">
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
        </ul>
        <ul className="flex snap-x gap-1 overflow-x-auto border-t border-border py-1 [scrollbar-width:thin]" aria-label={activeGroup.label}>
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
                    isActive ? "bg-burgundy font-medium text-white" : "text-muted hover:bg-off-white hover:text-ink"
                  )}
                >
                  {item.label}
                  {item.href ? <span aria-hidden="true"> ↗</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <nav aria-label="Settings sections" className="hidden lg:block lg:w-60 lg:shrink-0">
        <div className="sticky top-[73px] max-h-[calc(100vh-6rem)] space-y-5 overflow-y-auto pr-2">
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
                          isActive ? "bg-burgundy/10 font-medium text-burgundy" : "text-ink hover:bg-off-white"
                        )}
                      >
                        {item.label}
                        {item.href ? <span aria-hidden="true" className="ml-1 text-muted">↗</span> : null}
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
