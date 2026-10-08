"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ConfirmOptions {
  title: string;
  /** Body text / content describing what is about to happen. */
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button for destructive actions. */
  destructive?: boolean;
  /** When set, a reason textarea is shown (ReasonDialog behaviour). */
  reason?: {
    label: string;
    /** Minimum trimmed length. Defaults to 1 when `required`, otherwise 0 (optional). */
    minLength?: number;
    required?: boolean;
    placeholder?: string;
  };
}

/**
 * Accessible modal replacement for window.confirm()/prompt(): role="dialog" aria-modal, labelled by
 * its title and described by its message, Esc / backdrop cancel, Tab is trapped, focus moves in on
 * open and returns to the opener on close. With `reason` it also collects a (optionally required,
 * minimum-length) reason. Rendered in a portal so it is never nested inside the form it guards.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  reason,
  onConfirm,
  onCancel,
}: ConfirmOptions & { onConfirm: (reason: string) => void; onCancel: () => void }) {
  const titleId = useId();
  const descId = useId();
  const reasonId = useId();
  const errId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);

  const min = reason ? (reason.minLength ?? (reason.required ? 1 : 0)) : 0;
  const trimmed = text.trim();
  const reasonInvalid = !!reason && trimmed.length < min;
  const errorText = reason && touched && reasonInvalid ? (min > 1 ? `Enter at least ${min} characters.` : "A reason is required.") : null;

  const cancelCb = useRef(onCancel);
  useEffect(() => {
    cancelCb.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (reasonRef.current ?? cancelRef.current)?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancelCb.current();
        return;
      }
      if (e.key !== "Tab") return;
      // Keep a host SidePanel's own Tab trap from also acting on this event.
      e.stopPropagation();
      const root = dialogRef.current;
      const items = root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
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
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      if (opener && opener.isConnected) opener.focus?.();
    };
  }, []);

  function submit() {
    if (reasonInvalid) {
      setTouched(true);
      reasonRef.current?.focus();
      return;
    }
    onConfirm(trimmed);
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div
        ref={dialogRef}
        role={reason ? "dialog" : "alertdialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? descId : undefined}
        tabIndex={-1}
        className="w-full max-w-md rounded-lg bg-surface p-5 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-base font-semibold text-ink">
          {title}
        </h2>
        {message && (
          <div id={descId} className="mt-2 text-sm text-ink">
            {message}
          </div>
        )}
        {reason && (
          <div className="mt-3 space-y-1">
            <label htmlFor={reasonId} className="block text-sm font-medium text-ink">
              {reason.label}
              {min > 0 && <span className="sr-only"> <Tx>(required)</Tx></span>}
            </label>
            <textarea
              id={reasonId}
              ref={reasonRef}
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={reason.placeholder}
              aria-required={min > 0 ? true : undefined}
              aria-invalid={errorText ? true : undefined}
              aria-describedby={errorText ? errId : undefined}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
            />
            <div id={errId} role="alert">
              {errorText && <p className="text-xs font-medium text-danger">{errorText}</p>}
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button ref={cancelRef} type="button" variant="outline" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={submit}
            className={destructive ? "bg-danger text-white hover:bg-danger/90" : undefined}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Promise-style wrapper so call sites keep their old shape:
 *
 *   const { ask, dialog } = useConfirm();
 *   const reason = await ask({ title, message, reason: { label, minLength: 10 } }); // string | null
 *   if (reason === null) return;           // cancelled
 *   ...
 *   return <>{dialog}...</>;
 *
 * Resolves with the trimmed reason ("" when there is no reason field) or null when cancelled.
 * For a submit button inside a <form action>, use `askThenSubmit(options)` as its onClick.
 */
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const settle = useCallback((v: string | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  }, []);

  const ask = useCallback((o: ConfirmOptions) => {
    resolver.current?.(null);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
      setOpts(o);
    });
  }, []);

  // Resolve as cancelled if the host unmounts mid-dialog.
  useEffect(
    () => () => {
      resolver.current?.(null);
    },
    []
  );

  /** onClick for a submit button: blocks the native submit, asks, then re-submits via the same button. */
  const askThenSubmit = useCallback(
    (o: ConfirmOptions) => (e: { preventDefault: () => void; currentTarget: HTMLButtonElement }) => {
      e.preventDefault();
      const btn = e.currentTarget;
      // Let the browser's own field validation speak first, before asking for confirmation.
      if (btn.form && !btn.form.reportValidity()) return;
      void ask(o).then((r) => {
        if (r !== null && btn.isConnected) btn.form?.requestSubmit(btn);
      });
    },
    [ask]
  );

  /**
   * onSubmit for a <form action={...}>: when `opts` is non-null, blocks the submit, asks, then
   * re-submits (same submitter, so the form action runs). If the dialog collected a reason it is
   * written into the form's `reasonField` input (e.g. a hidden "revision_reason").
   */
  const approved = useRef(new WeakSet<HTMLFormElement>());
  const gateSubmit = useCallback(
    (opts: ConfirmOptions | null, reasonField?: string, onApproved?: () => void) =>
      (e: { preventDefault: () => void; currentTarget: HTMLFormElement; nativeEvent: Event }) => {
        const form = e.currentTarget;
        if (approved.current.has(form)) {
          approved.current.delete(form);
          onApproved?.();
          return;
        }
        if (!opts) {
          onApproved?.();
          return;
        }
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
        void ask(opts).then((r) => {
          if (r === null || !form.isConnected) return;
          if (reasonField) {
            const el = form.elements.namedItem(reasonField);
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = r;
          }
          approved.current.add(form);
          form.requestSubmit(submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : undefined);
        });
      },
    [ask]
  );

  const dialog = opts ? <ConfirmDialog {...opts} onConfirm={settle} onCancel={() => settle(null)} /> : null;
  return { ask, askThenSubmit, gateSubmit, dialog };
}
