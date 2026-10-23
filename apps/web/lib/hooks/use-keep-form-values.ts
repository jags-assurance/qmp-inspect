"use client";

import { startTransition, type FormEvent } from "react";

/**
 * React 19 resets an uncontrolled form after a `<form action={fn}>` finishes, so a server-side
 * validation error (for example "A project with that number already exists") also wipes every
 * other field the person had typed. Submitting through `onSubmit` + `startTransition` runs the
 * same action without that reset: the error shows beside its field and everything else stays.
 */
export function useKeepFormValues(formAction: (formData: FormData) => void) {
  return function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };
}
