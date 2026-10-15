"use client";

import { useRef, useState } from "react";
import { BarcodeScanButton } from "@/components/ui/barcode-scan-button";
import { useTranslate } from "@/lib/i18n/locale-context";

/** The start-work search box with a camera scan button: a scanned checklist code fills the box and runs the search. */
export function ScanSearchInput({ defaultValue }: { defaultValue: string }) {
  const tl = useTranslate();
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="flex w-full items-start gap-2">
      <input
        ref={inputRef}
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={tl("Search activity, ITP or checklist")}
        className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy sm:text-sm"
      />
      <BarcodeScanButton
        label="Scan"
        className="min-h-11"
        onCode={(code) => {
          setValue(code);
          // Wait a tick so the controlled input carries the new value, then run the search.
          setTimeout(() => inputRef.current?.form?.requestSubmit(), 0);
        }}
      />
    </div>
  );
}
