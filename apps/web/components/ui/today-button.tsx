"use client";

import { useEffect, useRef } from "react";
import { Tx } from "@/components/domain/tx";

/** Local calendar date as yyyy-mm-dd (what <input type="date"> expects), not the UTC date. */
function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * A small "Today" button for a date input in the same form, found by its `name`. It sets the value the way a
 * person typing would (so controlled inputs update too). With `fillOnLoad` it also pre-fills today when the
 * field is empty, for dates that are by nature "recorded now" (a walkdown, an assignment); dates that are
 * often not today (a project start, a certificate date) get the button only.
 */
export function TodayButton({ name, fillOnLoad = false }: { name: string; fillOnLoad?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);

  function input(): HTMLInputElement | null {
    const el = ref.current?.closest("form")?.elements.namedItem(name);
    return el instanceof HTMLInputElement ? el : null;
  }
  function setToday() {
    const el = input();
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, localToday());
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  useEffect(() => {
    if (!fillOnLoad) return;
    const el = input();
    if (el && !el.value) setToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillOnLoad]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={setToday}
      className="mt-1 text-xs font-medium text-burgundy hover:underline"
    >
      <Tx>Set to today</Tx>
    </button>
  );
}
