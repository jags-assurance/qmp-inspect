"use client";
import { Tx } from "@/components/domain/tx";
import { useSetFilterParam } from "@/lib/hooks/use-filter-param";

export interface DisciplineOption {
  id: string;
  code: string;
  name: string;
}

// Same reasoning as apps/web/app/inspect/vault/project-picker-form.tsx: an inline onChange handler
// is still a function, so it can't live directly in the Server Component page — this tiny wrapper
// owns it instead.
export function DisciplineFilterForm({
  disciplines,
  selectedDisciplineId,
}: {
  disciplines: DisciplineOption[];
  selectedDisciplineId: string | null;
}) {
  const setParam = useSetFilterParam();
  return (
    <form className="w-full md:w-auto">
      <label htmlFor="discipline" className="block text-xs font-medium text-muted">
        <Tx>Filter by discipline</Tx>
      </label>
      <select
        id="discipline"
        name="discipline"
        defaultValue={selectedDisciplineId ?? ""}
        onChange={(e) => setParam("discipline", e.currentTarget.value)}
        className="mt-1 min-h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink [@media(pointer:coarse)]:min-h-11 md:w-auto"
      >
        <option value=""><Tx>All disciplines</Tx></option>
        {disciplines.map((d) => (
          <option key={d.id} value={d.id}>
            {d.code} — {d.name}
          </option>
        ))}
      </select>
    </form>
  );
}
