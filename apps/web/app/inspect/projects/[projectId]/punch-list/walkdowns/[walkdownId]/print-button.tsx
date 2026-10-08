"use client";
import { Tx } from "@/components/domain/tx";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="min-h-10 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-off-white">
      <Tx>Print / save as PDF</Tx>
    </button>
  );
}
