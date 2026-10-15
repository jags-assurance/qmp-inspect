"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Tx } from "@/components/domain/tx";

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
    <label className="flex w-full min-w-0 flex-col gap-1 text-xs font-medium text-muted md:w-auto">
      <span><Tx>Organisation</Tx></span>
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
        className="min-h-10 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-sm font-normal text-ink [@media(pointer:coarse)]:min-h-11 md:w-auto"
      >
        <option value=""><Tx>All organisations</Tx></option>
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
