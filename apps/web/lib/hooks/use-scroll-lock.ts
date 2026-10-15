import { useEffect } from "react";

// Reference-counted body scroll lock: the first lock remembers the original value, the last unlock
// restores it, so stacked overlays (drawer + sheet + dialog) can open and close in any order.
let lockCount = 0;
let savedOverflow = "";

/** Locks body scroll and returns an idempotent unlock function. */
export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) document.body.style.overflow = savedOverflow;
  };
}

/** Locks body scroll while `active` (reference counted; safe with stacked overlays). */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    return lockBodyScroll();
  }, [active]);
}
