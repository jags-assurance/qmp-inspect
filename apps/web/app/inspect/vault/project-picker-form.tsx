"use client";
import { Tx } from "@/components/domain/tx";

export interface ProjectOption {
  id: string;
  project_number: string;
  name: string;
}

// A plain HTML element's event handler (onChange) is still a function — it can't be defined
// inline in a Server Component either, same rule as passing one as a component prop. This small
// client component exists purely to own that handler.
export function ProjectPickerForm({
  projects,
  selectedProject,
}: {
  projects: ProjectOption[];
  selectedProject: string | null;
}) {
  return (
    <form className="w-full md:max-w-sm">
      <label htmlFor="project" className="block text-xs font-medium text-muted">
        <Tx>Project</Tx>
      </label>
      <select
        id="project"
        name="project"
        defaultValue={selectedProject ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="mt-1 min-h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink [@media(pointer:coarse)]:min-h-11"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.project_number} — {p.name}
          </option>
        ))}
      </select>
    </form>
  );
}
