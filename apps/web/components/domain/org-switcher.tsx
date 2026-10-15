"use client";

import { useRef } from "react";
import { useTranslate } from "@/lib/i18n/locale-context";

/**
 * Switcher for users with grants in more than one organisation. Submits the server action on change.
 * `variant="inline"` is the compact 36px header select (laptop and up); `variant="stacked"` is the
 * full-width labelled 44px field used in the context sheet. `idPrefix` keeps ids unique.
 */
export function OrgSwitcher({
  options,
  activeId,
  action,
  variant = "inline",
  idPrefix = "header",
  onChanged,
}: {
  options: { id: string; name: string }[];
  activeId: string | null;
  action: (formData: FormData) => void | Promise<void>;
  variant?: "inline" | "stacked";
  idPrefix?: string;
  onChanged?: () => void;
}) {
  const tl = useTranslate();
  const formRef = useRef<HTMLFormElement>(null);
  const stacked = variant === "stacked";
  const id = `${idPrefix}-org-switcher`;
  return (
    <form ref={formRef} action={action} className={stacked ? "flex flex-col gap-1.5" : "flex items-center"}>
      <label className={stacked ? "text-sm font-medium text-ink" : "sr-only"} htmlFor={id}>{tl("Organisation")}</label>
      <select
        id={id}
        name="organization_id"
        defaultValue={activeId ?? undefined}
        onChange={() => {
          formRef.current?.requestSubmit();
          onChanged?.();
        }}
        className={
          stacked
            ? "min-h-11 w-full min-w-0 truncate rounded-md border border-border bg-surface px-3 text-base text-ink"
            : "h-9 [@media(pointer:coarse)]:h-11 min-w-0 max-w-[8rem] truncate rounded-md border border-border bg-surface px-2.5 text-sm text-ink hover:bg-surface-subtle xl:max-w-[10rem]"
        }
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </form>
  );
}
