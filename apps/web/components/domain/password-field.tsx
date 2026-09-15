"use client";

import { useState } from "react";

/** A password input with a show/hide toggle — shared by the sign-in and reset-password forms. */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  required = true,
  value,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  required?: boolean;
  value?: string;
  onChange?: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
      )}
      <div className="relative mt-1">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          required={required}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 pr-10 text-sm outline-none focus:border-burgundy"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
        >
          {visible ? (
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path
                d="M2.5 10.5C4 6.5 7 4.5 10 4.5s6 2 7.5 6c-1.5 4-4.5 6-7.5 6s-6-2-7.5-6z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="10" cy="10.5" r="2.25" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3 3l14 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
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
    </div>
  );
}
