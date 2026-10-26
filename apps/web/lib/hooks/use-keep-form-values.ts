"use client";

import { startTransition, useEffect, useRef, type FormEvent } from "react";

/** Fired on window when a form action succeeds without printing a message of its own. */
export const FORM_SAVED_EVENT = "jags:form-saved";

function hasOwnMessage(state: unknown): boolean {
  if (state === null || typeof state !== "object") return false;
  const o = state as { message?: unknown; notice?: unknown; created?: unknown; saved?: unknown };
  if (o.saved === true) return true;
  const m = o.message ?? o.notice ?? o.created;
  return typeof m === "string" && m.length > 0;
}

function actionSucceeded(state: unknown): boolean {
  if (state === null || typeof state !== "object") return true;
  const s = state as { error?: unknown; ok?: unknown; success?: unknown; fieldErrors?: unknown };
  if (s.error) return false;
  if (s.ok === false || s.success === false) return false;
  if (s.fieldErrors && typeof s.fieldErrors === "object" && Object.keys(s.fieldErrors).length > 0) return false;
  return true;
}

/**
 * React 19 resets an uncontrolled form after a `<form action={fn}>` finishes, so a server-side
 * validation error (for example "A project with that number already exists") also wipes every
 * other field the person had typed. Submitting through `onSubmit` + `startTransition` runs the
 * same action without that reset: on an error the message shows and every value stays; on
 * success the form is reset exactly as React would have done.
 *
 * Pass the state returned by `useActionState`, then use `<form onSubmit={onSubmit}>`.
 */
export function useKeepFormValues(state: unknown, formAction: (formData: FormData) => void) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (!submitted.current) return;
    submitted.current = false;
    const form = formRef.current;
    if (!form) return;
    if (actionSucceeded(state)) {
      form.reset();
      if (!hasOwnMessage(state)) window.dispatchEvent(new Event(FORM_SAVED_EVENT));
      return;
    }
    // Failed: take the person to the problem instead of leaving it off-screen below the fold.
    // Wait a frame so the field error / banner has rendered.
    requestAnimationFrame(() => {
      const bad = form.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (bad) {
        bad.focus({ preventScroll: true });
        bad.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      form.querySelector<HTMLElement>('[role="alert"]:not(:empty)')?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [state]);

  return function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const formData = submitter ? new FormData(form, submitter) : new FormData(form);
    formRef.current = form;
    submitted.current = true;
    startTransition(() => formAction(formData));
  };
}

/** Sets a field the way a person typing would, so controlled inputs pick the value up too. */
function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

function restoreForm(form: HTMLFormElement, snapshot: Array<[string, string]>) {
  const byName = new Map<string, string[]>();
  for (const [name, value] of snapshot) byName.set(name, [...(byName.get(name) ?? []), value]);
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) continue;
    if (!el.name || !byName.has(el.name)) continue;
    const values = byName.get(el.name) ?? [];
    if (el instanceof HTMLInputElement) {
      if (el.type === "file" || el.type === "hidden" || el.type === "submit" || el.type === "button") continue;
      if (el.type === "checkbox" || el.type === "radio") {
        const want = values.includes(el.value);
        if (el.checked !== want) el.click();
        continue;
      }
    }
    if (el instanceof HTMLSelectElement && el.multiple) {
      for (const o of Array.from(el.options)) o.selected = values.includes(o.value);
      continue;
    }
    if (el.value !== values[0]) setFieldValue(el, values[0]);
  }
}

/**
 * For forms that must keep a native `action={formAction}` plus their own `onSubmit` (confirm dialogs, offline
 * queues, file compression): React still resets the form after the action, so call the returned `capture(form)`
 * at the top of `onSubmit`. If the action then fails, the typed values are put back; on success nothing is
 * restored and the reset stands. Files and hidden fields are never touched.
 */
export function useRestoreOnError(state: unknown) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const snapshot = useRef<Array<[string, string]> | null>(null);

  useEffect(() => {
    const form = formRef.current;
    const snap = snapshot.current;
    if (!form || !snap) return;
    snapshot.current = null;
    if (actionSucceeded(state)) return;
    // Wait a frame so React's own reset has run first.
    requestAnimationFrame(() => {
      restoreForm(form, snap);
      const bad = form.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (bad) {
        bad.focus({ preventScroll: true });
        bad.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  }, [state]);

  return function capture(form: HTMLFormElement) {
    formRef.current = form;
    const entries: Array<[string, string]> = [];
    new FormData(form).forEach((value, key) => {
      if (typeof value === "string") entries.push([key, value]);
    });
    snapshot.current = entries;
  };
}
