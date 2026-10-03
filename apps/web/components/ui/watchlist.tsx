import type { ReactNode } from "react";
import Link from "next/link";

/**
 * One "window" of the dashboard grid: a titled, independently scrolling short list. Used by every
 * dashboard watchlist so they stay visually identical. Always states how much is hidden — when the
 * list is capped it shows "See all N →" instead of silently dropping rows.
 */
export function Watchlist<T extends { id: string }>({
  anchorId,
  title,
  description,
  items,
  total,
  renderItem,
  emptyText,
  seeAllHref,
}: {
  /** DOM id so another part of the page (e.g. a "+15 more" row) can scroll straight to this window. */
  anchorId?: string;
  title: string;
  description?: string;
  items: T[];
  /** True size of the underlying list when `items` is a capped slice of it. */
  total?: number;
  renderItem: (item: T) => ReactNode;
  emptyText: string;
  seeAllHref?: string;
}) {
  const hidden = total !== undefined ? total - items.length : 0;
  return (
    <div id={anchorId} className="flex scroll-mt-24 flex-col rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-medium text-ink">
        {title}
        {total !== undefined && total > 0 && <span className="ml-1.5 text-xs font-normal text-muted">({total})</span>}
      </h2>
      {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto overflow-x-hidden">
        {items.map((item) => (
          <li key={item.id} className="py-2 text-sm">
            {renderItem(item)}
          </li>
        ))}
        {items.length === 0 && <li className="py-2 text-sm text-muted">{emptyText}</li>}
      </ul>
      {hidden > 0 && seeAllHref && (
        <Link href={seeAllHref} className="mt-2 inline-flex min-h-8 items-center text-xs text-burgundy hover:underline">
          See all {total} →
        </Link>
      )}
      {hidden > 0 && !seeAllHref && <p className="mt-2 text-xs text-muted">Showing the {items.length} most recent of {total}.</p>}
    </div>
  );
}

export function WatchlistSkeleton({ title }: { title: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-4" aria-busy="true">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      <div className="mt-3 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded bg-off-white" />
        ))}
      </div>
    </div>
  );
}
