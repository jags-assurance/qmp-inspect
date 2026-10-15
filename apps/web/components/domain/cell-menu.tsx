"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useTranslate } from "@/lib/i18n/locale-context";

export interface CellMenuItem {
  key: string;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * Overflow ("...") menu for a dense table cell. The panel is portalled to <body> and positioned from
 * the trigger's rectangle, so a scrolling table wrapper (overflow-x-auto) can never clip it. Closes on
 * Escape, outside press, scroll and resize; arrow keys move between items. z-30 (dropdown layer).
 */
export function CellMenu({ items, ariaLabel }: { items: CellMenuItem[]; ariaLabel: string }) {
  const tl = useTranslate();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const width = 208;
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    const estHeight = items.length * 44 + 8;
    const top = spaceBelow < estHeight && r.top > estHeight ? r.top - estHeight - 4 : r.bottom + 4;
    setPos({ top, left });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const els = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        if (els.length === 0) return;
        e.preventDefault();
        const i = els.indexOf(document.activeElement as HTMLButtonElement);
        els[(i + (e.key === "ArrowDown" ? 1 : els.length - 1)) % els.length].focus();
      }
    }
    const onAway = () => close();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onAway);
    window.addEventListener("scroll", onAway, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onAway);
      window.removeEventListener("scroll", onAway, true);
    };
  }, [open, close]);

  if (items.length === 0) return null;

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="icon"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-8 w-8 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        onClick={() => setOpen((v) => !v)}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <circle cx="4.5" cy="10" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="15.5" cy="10" r="1.5" />
        </svg>
      </Button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={ariaLabel}
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
            className="fixed z-30 w-52 rounded-md border border-border bg-surface p-1 shadow-lg"
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.title ? tl(item.title) : undefined}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className="flex min-h-10 w-full items-center rounded px-3 py-2 text-start text-sm text-ink hover:bg-surface-subtle disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
