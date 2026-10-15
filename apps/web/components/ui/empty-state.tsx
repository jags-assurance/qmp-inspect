import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * "Nothing here yet" / "no results" block. Always say what is empty, why, and offer the next step
 * (`action`). `compact` is for use inside a table cell or card. Server-component safe; pass
 * translated nodes (<T>...</T>) for text.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center text-center", compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-12", className)}>
      <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken text-muted">
        {icon ?? (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M3.5 6.5l1.2-2.4A1.5 1.5 0 016 3.3h8a1.5 1.5 0 011.3.8l1.2 2.4M3.5 6.5V15a1.5 1.5 0 001.5 1.5h10A1.5 1.5 0 0016.5 15V6.5M3.5 6.5h4l.8 1.5h3.4l.8-1.5h4" />
          </svg>
        )}
      </span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
