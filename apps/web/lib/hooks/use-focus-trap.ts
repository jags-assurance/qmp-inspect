import { useEffect, type RefObject } from "react";
import { useEscapeLayer } from "./use-escape-layer";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus behaviour shared by the drawer, sheets and filter sheet: while `active`, Tab / Shift+Tab
 * cycle inside `ref`, Escape calls `onClose` (topmost layer only, see useEscapeLayer), focus moves into the container on open and returns to
 * whatever had it before on close. Pass `restoreFocus={false}` when the caller restores focus itself.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
  { restoreFocus = true }: { restoreFocus?: boolean } = {}
) {
  // Escape goes through the shared layer stack so a nested dropdown can close first.
  useEscapeLayer(active, onClose);
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = root.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? root).focus();

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab" || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === firstEl || current === root)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && current === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (restoreFocus) opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose identity changes must not re-run the trap (would steal focus)
  }, [active, ref]);
}
