"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

/** Plain GET-style filter — mirrors apps/web/app/inspect/organisation/usage/project-filter.tsx.
 *  The page itself does all the real work (it's a server component reading ?org= from
 *  searchParams), this just needs to change the URL. No client-side data fetching, no form state:
 *  picking an organisation is a navigation, not an interaction. */
export function OrgFilter({ organizations }: { organizations: { id: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("org") ?? "";

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-medium text-ink">Organisation</span>
      <select
        value={current}
        onChange={(e) => {
          const value = e.target.value;
          const params = new URLSearchParams(searchParams.toString());
          if (value) params.set("org", value);
          else params.delete("org");
          const query = params.toString();
          router.push(query ? `${pathname}?${query}` : pathname);
        }}
        className="rounded-md border border-border bg-off-white px-3 py-1.5 text-sm outline-none focus:border-burgundy"
      >
        <option value="">All organisations</option>
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
