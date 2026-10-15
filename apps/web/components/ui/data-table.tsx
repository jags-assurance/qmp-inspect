"use client";

import Link from "next/link";
import { BarcodeScanButton } from "@/components/ui/barcode-scan-button";
import { useMemo, useState, type ReactNode } from "react";
import { translateText } from "@/lib/i18n/dictionary";
import { useLocale } from "@/lib/i18n/locale-context";
import type { SupportedLocale } from "@/lib/i18n/direction";
import { Button } from "@/components/ui/button";

const BREAKPOINT = {
  sm: { table: "sm:block", cards: "sm:hidden" },
  md: { table: "md:block", cards: "md:hidden" },
  xl: { table: "xl:block", cards: "xl:hidden" },
} as const;

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
  breakpoint = "sm",
  renderCard,
  rowHref,
  scannable = false,
  locale: localeProp,
}: {
  /** Translates the column headings (English headings are the dictionary keys). Defaults to the
   *  locale supplied by the inspect layout (English when none). */
  locale?: SupportedLocale;
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
  /** Where the table turns into cards: "sm" (640px, default for existing pages) or "md" (768px, the
   *  design-system default for new/migrated registers: a 640-767px tablet shows cards, not a cramped grid). */
  breakpoint?: "sm" | "md" | "xl";
  /** Custom phone card. When omitted every column renders as a label/value row. Receive the row; keep it a
   *  single tappable block (link) with status badge + 2-3 key facts, not every column. */
  renderCard?: (row: T) => ReactNode;
  /** Optional: makes the whole phone card a link (used with the default label/value card). */
  rowHref?: (row: T) => string | null;
  /** Adds a camera barcode / QR scan button next to the search box (register lookups). */
  scannable?: boolean;
}) {
  const contextLocale = useLocale();
  const locale = localeProp ?? contextLocale;
  const [localQuery, setLocalQuery] = useState("");
  const isServerDriven = !!serverSearch;
  const query = isServerDriven ? serverSearch.value : localQuery;

  const filtered = useMemo(() => {
    if (isServerDriven) return rows; // already filtered server-side
    if (!query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((row) => searchKeys(row).toLowerCase().includes(q));
  }, [rows, query, searchKeys, isServerDriven]);

  const bp = BREAKPOINT[breakpoint];
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.totalCount / pagination.pageSize)) : null;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative w-full sm:max-w-xs">
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M17 17L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => (isServerDriven ? serverSearch.onChange(e.target.value) : setLocalQuery(e.target.value))}
          placeholder={translateText(locale, searchPlaceholder)}
          aria-label={translateText(locale, searchPlaceholder)}
          className="min-h-10 w-full rounded-md border border-border bg-surface ps-9 pe-3 py-1.5 text-base focus:border-burgundy sm:text-sm [@media(pointer:coarse)]:min-h-11"
        />
        </div>
        {scannable && (
          <BarcodeScanButton
            label="Scan code"
            onCode={(code) => (isServerDriven ? serverSearch.onChange(code) : setLocalQuery(code))}
          />
        )}
      </div>
      <div className={mobileCards ? `table-scroll hidden ${bp.table}` : "table-scroll"} tabIndex={0} role="region" aria-label={caption ?? "Data table"}>
        <table className="w-full text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10 bg-surface-subtle shadow-[0_1px_0_var(--color-border)]">
            <tr className="text-start text-xs font-semibold uppercase tracking-wide text-muted">
              {columns.map((col) => {
                const sorted = !!sort && sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={col.sortable && sort ? (sorted ? (sort.direction === "asc" ? "ascending" : "descending") : "none") : undefined}
                    className="px-4 py-2.5 font-semibold"
                  >
                    {col.sortable && sort ? (
                      <button type="button" onClick={() => sort.onSort(col.key)} className="inline-flex min-h-8 items-center gap-1 font-medium hover:text-ink">
                        {translateText(locale, col.header)}
                        <span aria-hidden="true">{sorted ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}</span>
                      </button>
                    ) : (
                      translateText(locale, col.header)
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-surface-subtle focus-within:bg-surface-subtle">
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
                  {emptyContent ?? translateText(locale, emptyMessage)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {mobileCards && (
        <ul className={`divide-y divide-border ${bp.cards}`}>
          {filtered.map((row, i) => {
            const href = rowHref?.(row) ?? null;
            return (
              <li key={i} className={renderCard ? "px-4 py-3 text-sm" : "space-y-1.5 px-4 py-3 text-sm"}>
                {renderCard
                  ? renderCard(row)
                  : columns.map((col) => (
                      <div key={col.key} className="flex justify-between gap-3">
                        <span className="text-xs text-muted">{translateText(locale, col.header)}</span>
                        <span className="min-w-0 text-end [overflow-wrap:anywhere]">{col.render(row)}</span>
                      </div>
                    ))}
                {href && (
                  <Link href={href} prefetch={false} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-brand hover:underline">
                    {translateText(locale, "Open")} →
                  </Link>
                )}
              </li>
            );
          })}
          {filtered.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">{emptyContent ?? translateText(locale, emptyMessage)}</li>}
        </ul>
      )}
      {pagination && totalPages !== null && pagination.totalCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-subtle/50 px-4 py-2.5 text-sm">
          <span className="text-muted">
            {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.totalCount)} {translateText(locale, "of")} {pagination.totalCount}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              variant="outline"
            >
              {translateText(locale, "Prev")}
            </Button>
            <span className="text-muted">
              {translateText(locale, "Page")} {pagination.page} {translateText(locale, "of")} {totalPages}
            </span>
            <Button
              type="button"
              disabled={pagination.page >= totalPages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              variant="outline"
            >
              {translateText(locale, "Next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
