"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

/**
 * Consistent label / hint / error wrapper. Clones the single child control to wire id,
 * aria-describedby, aria-invalid and aria-required so screen readers announce hint and error.
 */
export function FormField({
  label,
  children,
  hint,
  error,
  required,
  id: idProp,
}: {
  label: ReactNode;
  /** A stable id for the control (e.g. "email"), used by tests, password managers and deep links; a generated one is used when omitted. */
  id?: string;
  children: ReactElement<Record<string, unknown>>;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
}) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
      })
    : children;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required && (
          <span aria-hidden="true" className="ms-0.5 text-danger">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
