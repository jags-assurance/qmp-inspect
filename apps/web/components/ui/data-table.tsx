"use client";

import { useMemo, useState, type ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

/**
 * The canonical register/list pattern from the UI reference screens (ITP Register, NCR Register,
 * Observation Register, Projects list, etc.): a search box + a table. One implementation, reused
 * everywhere a list of records needs to be shown, instead of a bespoke table per screen.
 */
export function DataTable<T>({
  columns,
  rows,
  searchPlaceholder = "Search…",
  searchKeys,
  emptyMessage = "Nothing to show yet.",
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  searchPlaceholder?: string;
  searchKeys: (row: T) => string;
  emptyMessage?: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((row) => searchKeys(row).toLowerCase().includes(q));
  }, [rows, query, searchKeys]);

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="border-b border-border p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full max-w-xs rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-2 font-medium">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0 hover:bg-off-white">
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
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
