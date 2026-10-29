"use client";

import { useEffect } from "react";
import { spellAttrsFor } from "@/lib/forms/spellcheck";

function apply(el: Element) {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  // A field that already sets its own value (for example spellCheck={false}) is left exactly as written.
  if (el.hasAttribute("spellcheck")) return;
  const attrs = spellAttrsFor({ tagName: el.tagName, type: el instanceof HTMLInputElement ? el.type : undefined, name: el.name, id: el.id, dataset: el.dataset });
  if (!attrs) return;
  el.setAttribute("spellcheck", attrs.spellcheck);
  el.setAttribute("autocorrect", attrs.autocorrect);
  el.setAttribute("autocapitalize", attrs.autocapitalize);
}

/**
 * Turns on the browser's spell check, auto-correct and capitalisation for free-text fields across the app (see
 * lib/forms/spellcheck.ts for which fields). One shared rule instead of an attribute on every form; fields added later,
 * such as a form that opens in a panel, are picked up as they appear.
 */
export function SpellcheckDefaults() {
  useEffect(() => {
    const sweep = (root: ParentNode) => root.querySelectorAll("textarea, input").forEach(apply);
    sweep(document);
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          apply(n);
          sweep(n);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
