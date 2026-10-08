"use client";

/** "All projects" or one project: the scope of a report pack. Submits as `project_id` (empty = whole organisation). */
export function ProjectScopeSelect({ projects, id = "pack-project" }: { projects: { id: string; name: string }[]; id?: string }) {
  if (projects.length === 0) return null;
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-muted">Scope</label>
      <select
        id={id}
        name="project_id"
        defaultValue=""
        className="mt-1 w-56 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
