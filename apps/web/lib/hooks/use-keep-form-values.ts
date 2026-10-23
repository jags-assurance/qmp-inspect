"use client";

import { startTransition, useEffect, useRef, type FormEvent } from "react";

/** Fired on window when a form action succeeds without printing a message of its own. */
export const FORM_SAVED_EVENT = "jags:form-saved";

function hasOwnMessage(state: unknown): boolean {
  if (state === null || typeof state !== "object") return false;
  const o = state as { message?: unknown; notice?: unknown; created?: unknown };
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
