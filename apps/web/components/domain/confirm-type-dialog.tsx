"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * Confirmation for irreversible actions (compile / issue / acknowledge a Data Book handover). The
 * user sees what is about to be certified (`children`) and must type `phrase` (for example the book
 * number) before the confirm button enables. Escape / the backdrop cancels.
 */
export function ConfirmTypeDialog({
  title,
  phrase,
  confirmLabel,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  /** Exact text the user must type. Empty string = a plain confirm with no typing. */
  phrase: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const ok = phrase === "" || typed.trim() === phrase;

  useEffect(() => {
    (phrase ? inputRef.current : cancelRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, phrase]);

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-lg bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {children && <div className="mt-2 space-y-2 text-sm text-ink">{children}</div>}
        {phrase && (
          <div className="mt-3">
            <label htmlFor={inputId} className="block text-xs font-medium text-ink">
              Type <span className="font-mono">{phrase}</span> to confirm
            </label>
            <input
              id={inputId}
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
            />
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-off-white focus:outline-none focus:ring-2 focus:ring-burgundy"
          >
            Cancel
          </button>
          <Button type="button" size="sm" disabled={!ok} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
