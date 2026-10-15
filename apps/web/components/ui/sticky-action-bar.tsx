import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Action row for long forms. On phones it sticks to the bottom of the screen (above the iOS home
 * indicator and above any floating notice via --notice-h) so Save / Submit is always reachable with a
 * thumb; from md it is a normal inline row at the end of the form. Put the primary action first in
 * DOM order; `justify` aligns the group. Place it as the last child inside the <form>.
 */
export function StickyActionBar({
  children,
  className,
  justify = "start",
}: {
  children: ReactNode;
  className?: string;
  justify?: "start" | "end" | "between";
}) {
  return (
    <div
      className={cn(
        "no-print sticky bottom-[var(--notice-h,0px)] z-10 -mx-3 mt-6 flex flex-wrap items-center gap-2 border-t border-border bg-surface/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6",
        "md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:pt-0 md:pb-0 md:backdrop-blur-none",
        justify === "end" && "justify-end",
        justify === "between" && "justify-between",
        className
      )}
    >
      {children}
    </div>
  );
}
