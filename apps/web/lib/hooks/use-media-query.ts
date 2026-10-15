import { useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query. The server snapshot is `serverDefault` (false unless told
 * otherwise) so first paint matches SSR; prefer pure CSS (Tailwind breakpoints) when only styling
 * differs, and use this only when behaviour (focus trap, inert, mounting) depends on the breakpoint.
 */
export function useMediaQuery(query: string, serverDefault = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverDefault
  );
}
