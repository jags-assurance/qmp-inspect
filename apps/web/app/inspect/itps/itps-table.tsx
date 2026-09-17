"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { ITP_TABLE_PAGE_SIZE as PAGE_SIZE } from "./constants";

export interface ItpRow {
  id: string;
  itp_number: string;
  title: string;
  status: string;
  revision: number;
  projects: { name: string } | null;
}

// Exported so other pages rendering the same ITP status enum (e.g.
// app/inspect/itps/[id]/checklists/page.tsx) can reuse this instead of duplicating a copy.
export const ITP_STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "gold"> = {
  draft: "neutral",
  under_review: "warning",
  approved: "gold",
  client_accepted: "success",
};

export const ITP_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  under_review: "Under review",
  approved: "Approved",
  client_accepted: "Client accepted",
};

const COLUMNS: DataTableColumn<ItpRow>[] = [
  {
    key: "itp_number",
    header: "ITP No.",
    render: (row) => (
      <Link href={`/inspect/itps/${row.id}`} className="doc-id text-burgundy hover:underline">
        {row.itp_number}
      </Link>
    ),
  },
  {
    key: "title",
    header: "Title",
    // Round-table field-usability finding: only the (small, monospace) ITP number was clickable —
    // the title, the more visually prominent and legible column, was plain text.
    render: (row) => (
      <Link href={`/inspect/itps/${row.id}`} className="text-ink hover:underline">
        {row.title}
      </Link>
    ),
  },
  { key: "project", header: "Project", render: (row) => row.projects?.name ?? "—" },
  { key: "revision", header: "Rev", render: (row) => row.revision },
  {
    key: "status",
    header: "Status",
    render: (row) => <Badge tone={ITP_STATUS_TONE[row.status] ?? "neutral"}>{ITP_STATUS_LABEL[row.status] ?? row.status}</Badge>,
  },
];

/**
 * Round-table performance finding (same as apps/web/app/inspect/ncrs/ncrs-table.tsx): this
 * register used to receive and client-filter EVERY matching ITP row at once. `totalCount` (when
 * provided by the server page) switches this into server-driven search + pagination: `rows` is
 * just the current page, search text and page number both live in the URL (`q`, `page`). Falls
 * back to the original all-client-side behavior when `totalCount` is omitted.
 */
export function ItpsTable({ rows, totalCount }: { rows: ItpRow[]; totalCount?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const serverDriven = totalCount !== undefined;

  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (!serverDriven) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // A new search always jumps back to page 1 — staying on e.g. page 4 of a narrowed-down
      // result set almost always lands past the end and shows an empty table.
      pushParams({ q: searchValue || null, page: null });
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue, serverDriven]);

  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      searchPlaceholder="Search ITPs…"
      searchKeys={(row) => `${row.itp_number} ${row.title}`}
      emptyMessage="No ITPs yet."
      serverSearch={serverDriven ? { value: searchValue, onChange: setSearchValue } : undefined}
      pagination={
        serverDriven
          ? {
              page,
              pageSize: PAGE_SIZE,
              totalCount: totalCount!,
              onPageChange: (nextPage) => pushParams({ page: nextPage === 1 ? null : String(nextPage) }),
            }
          : undefined
      }
    />
  );
}
