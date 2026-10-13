"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const STACK_ID = "notice-stack";

/**
 * The one floating-notice container (install prompt, terms acceptance, toasts). Fixed to the bottom-end
 * corner on desktop and a full-width bottom sheet on phones, below modals (z-40). It publishes its own
 * height as --notice-h so the app shell can pad the page and nothing is ever hidden behind it.
 * Mounted once in the app shell; cards render into it through <NoticeCard>.
 */
export function NoticeStack() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--notice-h", el.childElementCount > 0 ? `${el.offsetHeight}px` : "0px");
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      root.style.removeProperty("--notice-h");
    };
  }, []);
  return (
    <div
      id={STACK_ID}
      ref={ref}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:end-4 sm:bottom-4 sm:w-96 sm:max-w-sm sm:p-0"
    />
  );
}

/** Renders its children as a card inside the shared stack (nothing until the stack exists). */
export function NoticeCard({ children, className = "", ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setTarget(document.getElementById(STACK_ID)), 0);
    return () => clearTimeout(t);
  }, []);
  if (!target) return null;
  return createPortal(
    <div
      {...rest}
      className={`pointer-events-auto rounded-lg border border-border bg-surface p-3 text-sm text-ink shadow-lg sm:p-4 ${className}`}
    >
      {children}
    </div>,
    target
  );
}
