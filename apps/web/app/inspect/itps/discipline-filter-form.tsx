"use client";
import { Tx } from "@/components/domain/tx";

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
  return (
    <form className="max-w-xs">
      <label htmlFor="discipline" className="block text-sm font-medium text-ink">
        <Tx>Filter by discipline</Tx>
      </label>
      <select
        id="discipline"
        name="discipline"
        defaultValue={selectedDisciplineId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
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
