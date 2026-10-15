import Link from "next/link";
import { cn } from "@/lib/cn";

export type WorkspaceTabKey =
  | "overview"
  | "punch-list"
  | "ncrs"
  | "observations"
  | "itps"
  | "registers"
  | "activity"
  | "kpis"
  | "data-book"
  | "reports"
  | "guide"
  | "audit-log";

export interface WorkspaceTab {
  key: WorkspaceTabKey;
  label: string;
  /** Short label for the tight phone tab bar. */
  short?: string;
  count?: number;
}

/**
 * The project workspace tab bar. Plain links (server-rendered, no JS needed) to `?tab=`, so a tab is
 * a shareable URL and Back works — but it stays inside the one project window: header and tab bar
 * persist, only the pane below changes. Scrolls sideways on a phone instead of wrapping into a
 * tall stack, stays pinned under the app header while the pane scrolls, and every target is 44px.
 */
export function WorkspaceTabs({
  projectId,
  tabs,
  active,
}: {
  projectId: string;
  tabs: WorkspaceTab[];
  active: WorkspaceTabKey;
}) {
  return (
    <nav
      aria-label="Project sections"
      className="sticky top-[calc(var(--header-h)+env(safe-area-inset-top))] z-[5] -mx-3 mt-6 border-b border-border bg-background px-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <ul className="flex snap-x gap-1 overflow-x-auto [scrollbar-width:thin]">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key} className="snap-start">
              <Link
                href={tab.key === "overview" ? `/inspect/projects/${projectId}` : `/inspect/projects/${projectId}?tab=${tab.key}`}
                scroll={false}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors sm:px-4",
                  isActive ? "border-burgundy text-burgundy" : "border-transparent text-muted hover:text-ink"
                )}
              >
                <span className="sm:hidden">{tab.short ?? tab.label}</span>
                <span className="hidden sm:inline">{tab.label}</span>
                {typeof tab.count === "number" && tab.count > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs leading-5",
                      isActive ? "bg-burgundy text-white" : "bg-off-white text-muted"
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function WorkspaceSkeleton() {
  return (
    <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading section">
      <div className="h-8 w-56 animate-pulse rounded bg-off-white" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-md bg-off-white" />
      ))}
    </div>
  );
}
