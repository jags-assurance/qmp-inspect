"use client";

import { useState } from "react";
import { useTranslate } from "@/lib/i18n/locale-context";

/** A password input with a show/hide toggle — shared by the sign-in and reset-password forms. */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  required = true,
  value,
  onChange,
  error,
  describedBy,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  required?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  /** Problem with this field (announced and linked via aria-describedby). */
  error?: string | null;
  /** id of an external hint paragraph to link via aria-describedby. */
  describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  const t = useTranslate();

  return (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
          {required && (
            <span aria-hidden="true" className="ms-0.5 text-danger">
              *
            </span>
          )}
          {required && <span className="sr-only"> {t("(required)")}</span>}
        </label>
      )}
      <div className="relative mt-1">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          required={required}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-required={required ? true : undefined}
          aria-describedby={[describedBy, error ? `${id}-err` : undefined].filter(Boolean).join(" ") || undefined}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          className="min-h-11 w-full rounded-md border border-control-border bg-surface ps-3 pe-12 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 aria-[invalid=true]:border-danger sm:text-sm"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("Hide password") : t("Show password")}
          aria-pressed={visible}
          className="absolute end-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-ink"
        >
          {visible ? (
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
              <path
                d="M2.5 10.5C4 6.5 7 4.5 10 4.5s6 2 7.5 6c-1.5 4-4.5 6-7.5 6s-6-2-7.5-6z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="10" cy="10.5" r="2.25" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3 3l14 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
              <path
                d="M2.5 10.5C4 6.5 7 4.5 10 4.5s6 2 7.5 6c-1.5 4-4.5 6-7.5 6s-6-2-7.5-6z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="10" cy="10.5" r="2.25" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          )}
        </button>
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
