import Link from "next/link";
import type { ListWindow } from "@/lib/pagination/list-limit";
import { T } from "@/components/domain/t";
import { buttonVariants } from "@/components/ui/button";

/**
 * Footer for a list that is windowed by `?limit=` (see lib/pagination/list-limit.ts): "Showing 200
 * of 640 punch items" plus a "Load more" link. Renders nothing when everything is already shown.
 * A plain link (no client state) so the next window is a normal server render.
 */
export function LoadMore({
  window: win,
  nextHref,
  noun,
  ceilingHint = "Narrow the list with the filters or export it to see the rest.",
}: {
  window: ListWindow;
  /** Href that requests `win.next` rows; ignored when win.next is null. */
  nextHref: string | null;
  noun: string;
  ceilingHint?: string;
}) {
  if (!win.hasMore) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-sm text-muted" role="status">
      <span>
        <T>Showing</T> {win.shown}
        {win.total !== null ? ` of ${win.total}` : "+"} {noun}.
      </span>
      {win.next !== null && nextHref ? (
        <Link href={nextHref} scroll={false} className={buttonVariants({ variant: "outline" })}>
          <T>Load more</T>
        </Link>
      ) : (
        <span>{ceilingHint}</span>
      )}
    </div>
  );
}
