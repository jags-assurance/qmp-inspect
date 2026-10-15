"use client";

import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { useScrollLock } from "@/lib/hooks/use-scroll-lock";
import { useTranslate } from "@/lib/i18n/locale-context";

/**
 * Bottom sheet (phones, small tablets) that becomes a centred dialog from `sm` up. Use it for short
 * secondary tasks that should not leave the page: the header context picker, mobile filters, a row's
 * action list. Built in: overlay tap / Esc / close button dismiss, Tab is trapped, focus returns to
 * the opener, body scroll is locked, the footer respects the iOS home-indicator inset.
 * z-50 (above the drawer, below ConfirmDialog).
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Sticky action row (Apply / Done). */
  footer?: ReactNode;
  className?: string;
}) {
  const tl = useTranslate();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, open, onClose);

  useScrollLock(open);

  if (!open || typeof document === "undefined") return null;
  // Portalled to <body>: the opener often lives in the sticky header (a z-20 stacking context), which would cap z-50.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative z-10 flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-xl border border-border bg-surface shadow-xl outline-none sm:max-w-md sm:rounded-xl",
          className
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tl("Close")}
            className="-me-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-subtle hover:text-ink"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="h-5 w-5">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <div className="border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
