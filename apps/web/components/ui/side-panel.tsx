"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const WIDTH_CLASS = {
  md: "max-w-md",
  lg: "max-w-xl",
  xl: "max-w-3xl",
} as const;

/**
 * The one shared "detail beside the list" window. Opens over the right edge of the current page so
 * the list/dashboard stays in place behind it, instead of navigating to a separate page.
 *
 * Built-in behaviours (all of the ones a hand-rolled div tends to miss): Esc closes, Tab is trapped
 * inside, focus moves in on open and returns to the opener on close, body scroll is locked,
 * aria-labelledby points at the title, the close button is a 44px target (gloves), and — when
 * `guardUnsaved` is on — closing after the user typed anything asks before throwing it away.
 */
export function SidePanel({
  open,
  onClose,
  title,
  description,
  children,
  width = "md",
  guardUnsaved = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  width?: keyof typeof WIDTH_CLASS;
  guardUnsaved?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dirtyRef = useRef(false);

  const requestClose = useCallback(() => {
    if (guardUnsaved && dirtyRef.current && !window.confirm("Discard what you've typed?")) return;
    onClose();
  }, [guardUnsaved, onClose]);

  // Keep the latest requestClose reachable from the single keydown listener below.
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  useEffect(() => {
    if (!open) return;
    dirtyRef.current = false;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusables = () => (panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : []);
    (focusables()[0] ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div aria-hidden="true" className="absolute inset-0 bg-ink/30" onClick={requestClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onInput={() => {
          dirtyRef.current = true;
        }}
        className={cn(
          "relative z-10 h-full w-full overflow-y-auto border-l border-border bg-surface p-5 shadow-xl outline-none sm:p-6",
          WIDTH_CLASS[width]
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close panel"
            className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-lg text-muted hover:bg-off-white hover:text-ink"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Panel open-state kept in the URL (`?<param>=<value>`) so a panel is deep-linkable, survives a
 * refresh, and the browser/Android Back button closes it instead of leaving the whole page.
 * Opening pushes a history entry; closing replaces it away, so Back never re-opens a closed panel.
 */
export function useUrlPanel(param: string) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get(param);

  // window.history (not router.push): Next.js syncs usePathname/useSearchParams with pushState and
  // replaceState, so the panel opens instantly instead of waiting for a full server re-render of the
  // (dynamic) page just to flip a query string — which took seconds on a slow connection.
  const open = useCallback(
    (next: string = "1") => {
      const params = new URLSearchParams(window.location.search);
      params.set(param, next);
      window.history.pushState(null, "", `${pathname}?${params.toString()}`);
    },
    [param, pathname]
  );

  const close = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete(param);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [param, pathname]);

  return { value, open, close };
}

/** Tiny transient confirmation ("Observation OBS-012 raised") that clears itself. */
export function useToast(durationMs = 6000) {
  const [message, setMessage] = useState<ReactNode | null>(null);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), durationMs);
    return () => clearTimeout(t);
  }, [message, durationMs]);
  return { message, show: setMessage, dismiss: () => setMessage(null) };
}

export function Toast({ message, onDismiss }: { message: ReactNode | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-ink px-4 py-3 text-sm text-white shadow-xl"
    >
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="h-8 w-8 rounded-md hover:bg-white/10">
        ✕
      </button>
    </div>
  );
}
