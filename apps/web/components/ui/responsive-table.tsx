import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { cardRowsFor } from "@/lib/ui/card-columns";

export interface ResponsiveColumn<T> {
  key: string;
  /** Column heading. A string doubles as the label on the phone card. */
  header: ReactNode;
  /** Visually hide the heading (icon / action columns); the th stays for screen readers. */
  srOnlyHeader?: boolean;
  render: (row: T) => ReactNode;
  /** Extra classes for this column's th and td (alignment, nowrap...). */
  className?: string;
  thClassName?: string;
  tdClassName?: string;
  /** Phone-card label override. `null` renders the value full width with no label. */
  cardLabel?: string | null;
  /** Leave this column off the phone card. */
  cardHidden?: boolean;
}

/**
 * Plain list table with the same phone-card behaviour as DataTable (below the sm breakpoint every
 * row becomes a stacked label/value card instead of a sideways-scrolling grid) but WITHOUT
 * DataTable's search box and card chrome, so existing register tables whose desktop markup must
 * not change can adopt it. Server- and client-component safe (no hooks).
 */
export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  tableClassName = "w-full text-sm",
  wrapperClassName = "overflow-x-auto",
  theadClassName,
  headRowClassName = "border-b border-border text-start text-xs text-muted",
  thClassName = "px-3 py-2 font-medium",
  tdClassName = "px-3 py-2",
  rowClassName = "border-b border-border last:border-0",
  emptyCellClassName = "px-3 py-8 text-center text-muted",
  cardClassName,
  scrollRegionLabel,
  breakpoint = "sm",
  cardTitle,
  cardActions,
  bordered = false,
}: {
  columns: ResponsiveColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Screen-reader caption for the table. */
  caption?: string;
  /** Shown (table row and card) when there are no rows. */
  empty?: ReactNode;
  tableClassName?: string;
  wrapperClassName?: string;
  theadClassName?: string;
  headRowClassName?: string;
  thClassName?: string;
  tdClassName?: string;
  rowClassName?: string | ((row: T) => string);
  emptyCellClassName?: string;
  /** Extra classes for each phone card (<li>). */
  cardClassName?: string | ((row: T) => string);
  /** Makes the desktop scroll wrapper a focusable labelled region (keyboard scrolling). */
  scrollRegionLabel?: string;
  /** Where the table becomes cards: "sm" (640px, existing behaviour) or "md" (768px, design-system default for new pages). */
  breakpoint?: "sm" | "md";
  /** Rendered at the top of each phone card (usually the record link + status badge). */
  cardTitle?: (row: T) => ReactNode;
  /** Rendered at the bottom of each phone card (row actions). Same actions as the table row: never drop one on phones. */
  cardActions?: (row: T) => ReactNode;
  /** Card look: each phone row is its own bordered card instead of a divided list. */
  bordered?: boolean;
}) {
  const bp = breakpoint === "md" ? { table: "md:block", cards: "md:hidden" } : { table: "sm:block", cards: "sm:hidden" };
  const cardCols = cardRowsFor(columns);
  return (
    <>
      <div
        className={cn(wrapperClassName, "hidden", bp.table)}
        {...(scrollRegionLabel ? { tabIndex: 0, role: "region", "aria-label": scrollRegionLabel } : {})}
      >
        <table className={tableClassName}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className={theadClassName}>
            <tr className={headRowClassName}>
              {columns.map((col) => (
                <th key={col.key} scope="col" className={cn(thClassName, col.className, col.thClassName)}>
                  {col.srOnlyHeader ? <span className="sr-only">{col.header}</span> : col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={rowKey(row, i)} className={typeof rowClassName === "function" ? rowClassName(row) : rowClassName}>
                {columns.map((col) => (
                  <td key={col.key} className={cn(tdClassName, col.className, col.tdClassName)}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && empty != null && (
              <tr>
                <td colSpan={columns.length} className={emptyCellClassName}>
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ul className={cn(bordered ? "space-y-3" : "divide-y divide-border", bp.cards)} aria-label={caption}>
        {rows.map((row, i) => (
          <li
            key={rowKey(row, i)}
            className={cn(bordered ? "space-y-1.5 rounded-lg border border-border bg-surface p-3.5 text-sm shadow-xs" : "space-y-1 py-3 text-sm", typeof cardClassName === "function" ? cardClassName(row) : cardClassName)}
          >
            {cardTitle && <div className="mb-1">{cardTitle(row)}</div>}
            {cardCols.map(({ col, label }) =>
              label === null ? (
                <div key={col.key}>{col.render(row)}</div>
              ) : (
                <div key={col.key} className="flex justify-between gap-3">
                  <span className="text-xs text-muted">{label}</span>
                  <span className="min-w-0 text-end [overflow-wrap:anywhere]">{col.render(row)}</span>
                </div>
              ),
            )}
            {cardActions && <div className="flex flex-wrap items-center gap-2 pt-1">{cardActions(row)}</div>}
          </li>
        ))}
        {rows.length === 0 && empty != null && <li className="py-8 text-center text-sm text-muted">{empty}</li>}
      </ul>
    </>
  );
}
