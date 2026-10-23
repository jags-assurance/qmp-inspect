"use client";

import { startTransition, useEffect, useRef, type FormEvent } from "react";

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
    if (actionSucceeded(state)) formRef.current?.reset();
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
