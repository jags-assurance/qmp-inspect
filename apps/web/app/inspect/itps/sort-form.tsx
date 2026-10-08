"use client";
import { Tx } from "@/components/domain/tx";

const OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Newest first" },
  { value: "number", label: "ITP number" },
  { value: "title", label: "Title A-Z" },
  { value: "status", label: "Status" },
];

// GET form that keeps every other register filter as hidden inputs and resets paging.
export function SortForm({ current, params }: { current: string; params: Record<string, string> }) {
  return (
    <form className="max-w-xs">
      {Object.entries(params).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label htmlFor="sort" className="block text-sm font-medium text-ink">
        <Tx>Sort by</Tx>
      </label>
      <select
        id="sort"
        name="sort"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}
