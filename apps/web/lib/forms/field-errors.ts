/**
 * Optional per-field problems returned by a server action next to its form-level `error`:
 *
 *   return { error: "Describe the nonconformance (at least 10 characters).", fieldErrors: { description: "Enter at least 10 characters." } };
 *
 * The form renders `fieldErrors[name]` through `<FormField error=…>` (announced, linked with
 * aria-describedby) and keeps the form-level `error` as the fallback for anything not tied to one input.
 * Keys are the input `name`s of the form.
 */
export type FieldErrors = Record<string, string>;
