"use client";
import { Tx } from "@/components/domain/tx";
import { useSetFilterParam } from "@/lib/hooks/use-filter-param";

const OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Newest first" },
  { value: "number", label: "ITP number" },
  { value: "title", label: "Title A-Z" },
  { value: "status", label: "Status" },
  { value: "completion", label: "Completion (highest first)" },
];

// GET form that keeps every other register filter as hidden inputs and resets paging.
export function SortForm({ current, params }: { current: string; params: Record<string, string> }) {
  const setParam = useSetFilterParam();
  return (
    <form className="w-full md:w-auto">
      {Object.entries(params).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label htmlFor="sort" className="block text-xs font-medium text-muted">
        <Tx>Sort by</Tx>
      </label>
      <select
        id="sort"
        name="sort"
        defaultValue={current}
        onChange={(e) => setParam("sort", e.currentTarget.value)}
        className="mt-1 min-h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink [@media(pointer:coarse)]:min-h-11 md:w-auto"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            <Tx>{o.label}</Tx>
          </option>
        ))}
      </select>
    </form>
  );
}
