"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useTranslate } from "@/lib/i18n/locale-context";

const MIN = 260; // px — narrowest list column
const MIN_PANE = 360; // px — narrowest detail column

/**
 * A list/detail split you can stretch. On lg+ the two panes sit side by side with a draggable
 * divider (mouse, touch or keyboard: ←/→ to resize, Home/End for min/max, Enter to toggle), and an
 * "expand" button hands the whole width to the detail pane and back. The chosen width is
 * remembered per `storageKey`. Below lg it does not split: `showDetail` decides whether the phone
 * sees the list or the detail (the page supplies the back link), so nothing is squeezed.
 */
export function SplitLayout({
  list,
  detail,
  showDetail,
  storageKey,
  defaultListWidth,
  detailActions,
  defaultExpanded = false,
}: {
  list: ReactNode;
  detail: ReactNode;
  /** True when something is selected — drives the phone view and the expand control. */
  showDetail: boolean;
  storageKey: string;
  /** Fixed px override for the list column; when omitted the list takes ~38% of the width (380-560px). */
  defaultListWidth?: number;
  /** Optional controls shown in the detail toolbar next to the Expand button (e.g. "Open full page"). */
  detailActions?: ReactNode;
  /** Start with the detail using the full width (the list is one click away via "Show list"). For lists that are short, where a permanent list column is mostly empty space. */
  defaultExpanded?: boolean;
}) {
  const tl = useTranslate();
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // null = not user-sized yet: the CSS clamp() default applies so the list scales with the viewport.
  const [stored, setWidth] = useState<number | null>(defaultListWidth ?? null);
  const widthNow = () => stored ?? listRef.current?.getBoundingClientRect().width ?? 420;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [dragging, setDragging] = useState(false);

  // Restore the saved width after mount (read in an effect so server and first client render agree).
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(`split:${storageKey}`));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (Number.isFinite(saved) && saved >= MIN) setWidth(saved);
    } catch {
      // storage unavailable — keep the default
    }
  }, [storageKey]);

  const clamp = useCallback((w: number) => {
    const total = containerRef.current?.getBoundingClientRect().width ?? 1200;
    return Math.max(MIN, Math.min(w, total - MIN_PANE));
  }, []);

  const commit = useCallback(
    (w: number) => {
      const next = clamp(w);
      setWidth(next);
      try {
        localStorage.setItem(`split:${storageKey}`, String(Math.round(next)));
      } catch {
        // ignore
      }
    },
    [clamp, storageKey]
  );

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging || !containerRef.current) return;
    const left = containerRef.current.getBoundingClientRect().left;
    setWidth(clamp(e.clientX - left));
  }
  function onPointerUp() {
    if (!dragging) return;
    setDragging(false);
    commit(widthNow());
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") commit(widthNow() - 40);
    else if (e.key === "ArrowRight") commit(widthNow() + 40);
    else if (e.key === "Home") commit(MIN);
    else if (e.key === "End") commit(9999);
    else if (e.key === "Enter") setExpanded((v) => !v);
    else return;
    e.preventDefault();
  }

  const split = showDetail && !expanded;

  return (
    <div
      ref={containerRef}
      className={cn("mt-4", showDetail ? "lg:flex lg:items-start" : "")}
      style={{ ["--split-list" as string]: stored === null ? "clamp(380px, 38%, 560px)" : `${stored}px` }}
    >
      {/* List: hidden on phones/tablets while a detail is open; on lg it is the left column, sticky (or hidden when the detail is expanded). */}
      <div
        ref={listRef}
        className={cn(
          "min-w-0",
          showDetail
            ? expanded
              ? "hidden"
              : // The list stays in view while a long detail scrolls (own scroll if it is taller than the screen), so the
                // left column never turns into an empty gap beside the detail.
                "hidden lg:block lg:w-[var(--split-list)] lg:shrink-0 lg:sticky lg:top-[calc(var(--header-h,4rem)+0.75rem)] lg:max-h-[calc(100dvh-var(--header-h,4rem)-1.5rem)] lg:overflow-y-auto lg:overscroll-contain"
            : "w-full"
        )}
      >
        {list}
      </div>

      {split && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={tl("Resize list and detail panes (arrow keys; Enter expands the detail)")}
          aria-valuenow={stored === null ? undefined : Math.round(stored)}
          aria-valuemin={MIN}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
          className={cn(
            "mx-0.5 hidden w-3 shrink-0 cursor-col-resize touch-none self-stretch rounded lg:block",
            "hover:bg-burgundy/20 focus-visible:bg-burgundy/30 focus-visible:outline-none",
            dragging && "bg-burgundy/30"
          )}
        >
          <span className="mx-auto mt-16 block h-10 w-0.5 rounded bg-border" aria-hidden="true" />
        </div>
      )}

      {showDetail && (
        <div className="min-w-0 flex-1">
          <div className="mb-3 hidden items-center justify-end gap-3 lg:flex">
            {detailActions}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-pressed={expanded}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-ink hover:bg-surface-subtle"
            >
              {expanded ? "⤡ Show list" : "⤢ Expand"}
            </button>
          </div>
          {detail}
        </div>
      )}
    </div>
  );
}
