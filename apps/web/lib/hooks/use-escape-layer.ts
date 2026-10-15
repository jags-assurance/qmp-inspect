import { useEffect, useRef } from "react";

// Escape is handled by the topmost open layer only. Layers listen in the capture phase and stop
// propagation, so a dropdown inside a sheet closes itself and the sheet's own listener never sees the key.
const stack: symbol[] = [];

/** While `active`, Escape calls `onEscape` if this is the topmost layer (later-opened layers win). */
export function useEscapeLayer(active: boolean, onEscape: () => void) {
  const handler = useRef(onEscape);
  useEffect(() => {
    handler.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    const id = Symbol("escape-layer");
    stack.push(id);
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || stack[stack.length - 1] !== id) return;
      e.stopPropagation();
      handler.current();
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
