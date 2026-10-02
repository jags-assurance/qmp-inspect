"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

/** Plain GET-style filter — the page itself does all the real work (it's a server component reading
 *  ?project= from searchParams), this just needs to change the URL. No client-side data fetching, no
 *  form state: picking a project is a navigation, not an interaction. */
export function ProjectFilter({ projects }: { projects: { id: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("project") ?? "";

  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium text-ink">Project</span>
      <select
        value={current}
        onChange={(e) => {
          const value = e.target.value;
          const params = new URLSearchParams(searchParams.toString());
          if (value) params.set("project", value);
          else params.delete("project");
          const query = params.toString();
          router.push(query ? `${pathname}?${query}` : pathname);
        }}
        className="rounded-md border border-border bg-off-white px-3 py-1.5 text-sm outline-none focus:border-burgundy"
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
