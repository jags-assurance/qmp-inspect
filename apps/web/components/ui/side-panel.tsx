"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const EXPANDED_CLASS = "max-w-[min(1200px,100vw)]";

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
  // Stretchable: a button grows the panel to (almost) the full screen and back, remembered per user.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(localStorage.getItem("sidepanel:expanded") === "1");
    } catch {
      // storage unavailable
    }
  }, []);
  function toggleExpanded() {
    setExpanded((v) => {
      try {
        localStorage.setItem("sidepanel:expanded", v ? "0" : "1");
      } catch {
        // ignore
      }
      return !v;
    });
  }

  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const requestClose = useCallback(() => {
    if (guardUnsaved && dirtyRef.current) {
      setConfirmingDiscard(true);
      return;
    }
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
      // After a server refresh the opener may have been replaced; fall back to the page's main region.
      const opener = openerRef.current;
      if (opener && opener.isConnected) opener.focus?.();
      else document.getElementById("main-content")?.focus?.();
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
        onInput={(e) => {
          // Only real form fields count as "unsaved" — typing in a search / filter box must not make
          // Esc or a backdrop click raise a discard prompt.
          const t = e.target as HTMLElement;
          const isField = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
          const isSearch =
            (t instanceof HTMLInputElement && (t.type === "search" || t.getAttribute("role") === "searchbox")) ||
            t.closest("[data-no-dirty]") !== null;
          if (isField && !isSearch) dirtyRef.current = true;
        }}
        className={cn(
          "relative z-10 h-full w-full overflow-y-auto border-l border-border bg-surface p-5 shadow-xl outline-none sm:p-6",
          expanded ? EXPANDED_CLASS : WIDTH_CLASS[width]
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <div className="-mr-2 -mt-1 flex shrink-0 items-center">
            <button
              type="button"
              onClick={toggleExpanded}
              aria-pressed={expanded}
              aria-label={expanded ? "Shrink panel" : "Expand panel"}
              title={expanded ? "Shrink panel" : "Expand panel"}
              className="hidden h-11 w-11 items-center justify-center rounded-md text-lg text-muted hover:bg-off-white hover:text-ink sm:inline-flex"
            >
              {expanded ? "⤡" : "⤢"}
            </button>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close panel"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-lg text-muted hover:bg-off-white hover:text-ink"
          >
            ✕
          </button>
          </div>
        </div>
        {children}
      </div>
      {confirmingDiscard && (
        <ConfirmDialog
          title="Discard what you've typed?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          destructive
          onCancel={() => setConfirmingDiscard(false)}
          onConfirm={() => {
            setConfirmingDiscard(false);
            onClose();
          }}
        />
      )}
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

// Toasts pause while the pointer or keyboard focus is on one (WCAG 2.2.1 Timing Adjustable) — a
// module-level flag + event so existing useToast()/<Toast> call sites need no changes.
let toastPaused = false;
const TOAST_RESUME_EVENT = "jags-toast-resume";

/** Tiny transient confirmation ("Observation OBS-012 raised") that clears itself — unless the user
 *  is hovering it or has focus inside it, in which case the countdown restarts when they leave. */
export function useToast(durationMs = 6000) {
  const [message, setMessage] = useState<ReactNode | null>(null);
  const [resumeTick, setResumeTick] = useState(0);
  useEffect(() => {
    const onResume = () => setResumeTick((n) => n + 1);
    window.addEventListener(TOAST_RESUME_EVENT, onResume);
    return () => window.removeEventListener(TOAST_RESUME_EVENT, onResume);
  }, []);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => {
      if (!toastPaused) setMessage(null);
    }, durationMs);
    return () => clearTimeout(t);
  }, [message, durationMs, resumeTick]);
  return { message, show: setMessage, dismiss: () => setMessage(null) };
}

function setToastPaused(paused: boolean) {
  toastPaused = paused;
  if (!paused) window.dispatchEvent(new Event(TOAST_RESUME_EVENT));
}

/**
 * The live region is rendered on every pass (empty when there is no message) and only its content
 * changes — text inserted into an existing live region is announced reliably, text mounted together
 * with its own role="status" element often is not.
 */
export function Toast({ message, onDismiss }: { message: ReactNode | null; onDismiss: () => void }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      {message ? (
        <div
          onMouseEnter={() => setToastPaused(true)}
          onMouseLeave={() => setToastPaused(false)}
          onFocus={() => setToastPaused(true)}
          onBlur={() => setToastPaused(false)}
          className="pointer-events-auto flex max-w-[92vw] items-center gap-3 rounded-lg border border-border bg-ink px-4 py-3 text-sm text-white shadow-xl"
        >
          <span>{message}</span>
          <button
            type="button"
            onClick={() => {
              setToastPaused(false);
              onDismiss();
            }}
            aria-label="Dismiss"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-white/10"
          >
            ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}
