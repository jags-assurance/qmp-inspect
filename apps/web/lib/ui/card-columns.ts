import type { ReactNode } from "react";

interface CardColumnInput {
  key: string;
  header: ReactNode;
  cardLabel?: string | null;
  cardHidden?: boolean;
}

/**
 * Which columns appear on a phone card and with what label. A string header is the label; a
 * non-string header (or an explicit `cardLabel: null`) renders the value full width with no label;
 * `cardHidden` drops the column.
 */
export function cardRowsFor<C extends CardColumnInput>(columns: C[]): { col: C; label: string | null }[] {
  return columns
    .filter((col) => !col.cardHidden)
    .map((col) => ({
      col,
      label: col.cardLabel !== undefined ? col.cardLabel : typeof col.header === "string" ? col.header : null,
    }));
}
