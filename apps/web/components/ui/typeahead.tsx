"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type TypeaheadOption = { key: string; title: string; detail?: string; badge?: string };

/** Wraps the part of `text` that matches `query` so people see why a row is in the list. */
function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-gold/30 px-0.5 text-ink">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/**
 * A search box with a live list under it: the list opens on focus, narrows with every key, matches are
 * highlighted, and Arrow keys / Enter / Escape work. The caller supplies the options (already filtered or
 * fetched); this only handles presentation and keyboard.
 */
export function Typeahead({
  label,
  hint,
  value,
  onChange,
  options,
  onPick,
  loading = false,
  placeholder,
  emptyText,
  minChars = 0,
  disabled = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: TypeaheadOption[];
  onPick: (key: string) => void;
  loading?: boolean;
  placeholder?: string;
  emptyText: string;
  minChars?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const showList = open && !disabled && value.trim().length >= minChars;

  useEffect(() => {
    function away(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  function pick(i: number) {
    const o = options[i];
    if (!o) return;
    onPick(o.key);
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={id} className="block text-xs font-medium text-ink">
        {label} {hint && <span className="font-normal text-muted">{hint}</span>}
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, Math.max(options.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && showList && options[active]) {
            e.preventDefault();
            pick(active);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
      />
      {showList && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface shadow-md">
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted" role="presentation">
              {loading ? "Searching…" : emptyText}
            </li>
          ) : (
            options.map((o, i) => (
              <li key={o.key} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  className={cn("flex min-h-11 w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm", i === active ? "bg-surface-subtle" : "hover:bg-surface-subtle")}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink"><Highlight text={o.title} query={value} /></span>
                    {o.detail && <span className="block truncate text-xs text-muted"><Highlight text={o.detail} query={value} /></span>}
                  </span>
                  {o.badge && <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted">{o.badge}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
