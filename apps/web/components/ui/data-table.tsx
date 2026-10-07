"use client";

import { useMemo, useState, type ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  /** Opt-in: header becomes a sort button (needs the `sort` prop). */
  sortable?: boolean;
  render: (row: T) => ReactNode;
}

export interface DataTableServerSearch {
  /** Current search text, owned by the parent (usually mirrored to a URL search param). */
  value: string;
  onChange: (value: string) => void;
}

export interface DataTableSort {
  key: string;
  direction: "asc" | "desc";
  onSort: (key: string) => void;
}

export interface DataTablePagination {
  page: number; // 1-indexed
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}

/**
 * The canonical register/list pattern from the UI reference screens (ITP Register, NCR Register,
 * Observation Register, Projects list, etc.): a search box + a table. One implementation, reused
 * everywhere a list of records needs to be shown, instead of a bespoke table per screen.
 *
 * Round-table performance finding: every call site fetched its ENTIRE table server-side and handed
 * the full array here, filtered client-side on every keystroke — fine at a few hundred rows, a real
 * problem once a large tenant accumulates thousands. `serverSearch` and `pagination` are opt-in:
 * when provided, `rows` is assumed to already be exactly the current page's (already-filtered)
 * rows, and this component stops doing its own client-side filtering/pagination — the search input
 * becomes controlled by the parent and pagination controls render below the table. Omitting both
 * keeps the original all-client-side behavior unchanged, so existing call sites need no changes
 * until they're deliberately migrated.
 */
export function DataTable<T>({
  columns,
  rows,
  searchPlaceholder = "Search…",
  searchKeys,
  emptyMessage = "Nothing to show yet.",
  serverSearch,
  pagination,
  emptyContent,
  sort,
  caption,
  mobileCards = true,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  searchPlaceholder?: string;
  searchKeys: (row: T) => string;
  emptyMessage?: string;
  /** When set, the search input is controlled server-side instead of filtering `rows` in-memory. */
  serverSearch?: DataTableServerSearch;
  /** When set, renders Prev/Next controls below the table instead of showing every row at once. */
  pagination?: DataTablePagination;
  /** Rich empty state node (CTA etc.); takes precedence over emptyMessage. */
  emptyContent?: ReactNode;
  /** Controlled sort state for columns marked `sortable` (adds aria-sort + header buttons). */
  sort?: DataTableSort;
  /** Visually hidden caption / region label for screen readers. */
  caption?: string;
  /** Below the sm breakpoint show each row as a stacked label/value card instead of the table
   *  (default on; pass false for a table that must stay a scrolling grid on phones). */
  mobileCards?: boolean;
}) {
  const [localQuery, setLocalQuery] = useState("");
  const isServerDriven = !!serverSearch;
  const query = isServerDriven ? serverSearch.value : localQuery;

  const filtered = useMemo(() => {
    if (isServerDriven) return rows; // already filtered server-side
    if (!query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((row) => searchKeys(row).toLowerCase().includes(q));
  }, [rows, query, searchKeys, isServerDriven]);

  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.totalCount / pagination.pageSize)) : null;

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="border-b border-border p-3">
        <input
          value={query}
          onChange={(e) => (isServerDriven ? serverSearch.onChange(e.target.value) : setLocalQuery(e.target.value))}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="min-h-10 w-full max-w-xs rounded-md border border-border px-3 py-1.5 text-base focus:border-burgundy sm:text-sm"
        />
      </div>
      <div className={mobileCards ? "table-scroll hidden sm:block" : "table-scroll"} tabIndex={0} role="region" aria-label={caption ?? "Data table"}>
        <table className="w-full text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10 bg-surface shadow-[0_1px_0_var(--color-border)]">
            <tr className="text-left text-xs text-muted">
              {columns.map((col) => {
                const sorted = !!sort && sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={col.sortable && sort ? (sorted ? (sort.direction === "asc" ? "ascending" : "descending") : "none") : undefined}
                    className="px-4 py-2 font-medium"
                  >
                    {col.sortable && sort ? (
                      <button type="button" onClick={() => sort.onSort(col.key)} className="inline-flex min-h-8 items-center gap-1 font-medium hover:text-ink">
                        {col.header}
                        <span aria-hidden="true">{sorted ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}</span>
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-off-white focus-within:bg-off-white">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3">
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-muted">
                  {emptyContent ?? emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {mobileCards && (
        <ul className="divide-y divide-border sm:hidden">
          {filtered.map((row, i) => (
            <li key={i} className="space-y-1 px-4 py-3 text-sm">
              {columns.map((col) => (
                <div key={col.key} className="flex justify-between gap-3">
                  <span className="text-xs text-muted">{col.header}</span>
                  <span className="text-right">{col.render(row)}</span>
                </div>
              ))}
            </li>
          ))}
          {filtered.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">{emptyContent ?? emptyMessage}</li>}
        </ul>
      )}
      {pagination && totalPages !== null && pagination.totalCount > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-sm">
          <span className="text-muted">
            {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.totalCount)} of {pagination.totalCount}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              className="rounded-md border border-border min-h-10 px-3 py-1 font-medium text-ink hover:bg-off-white disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Prev
            </button>
            <span className="text-muted">
              Page {pagination.page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={pagination.page >= totalPages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              className="rounded-md border border-border min-h-10 px-3 py-1 font-medium text-ink hover:bg-off-white disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
