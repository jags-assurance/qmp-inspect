/**
 * The number shown for an ITP activity. item_number is normally stored already qualified by its section
 * ("1.2"), but older or hand-entered rows may hold only the in-section part ("2"). Prefixing blindly gave
 * "1.1.2" for item 1.2.
 */
export function displayItemNumber(sectionNumber: number | string, itemNumber: string | number): string {
  const item = String(itemNumber).trim();
  const prefix = `${sectionNumber}.`;
  return item.startsWith(prefix) ? item : `${prefix}${item}`;
}
