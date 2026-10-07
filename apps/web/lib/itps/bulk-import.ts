import { parseCsv } from "@/lib/registers/csv";

// Pure parser for the "paste activities from a spreadsheet" import. Real CSV/TSV parsing (quoted cells,
// embedded commas and newlines) instead of splitting on every comma, optional header row, and optional
// columns for evidence type, planned date and one sign-off level per party.

export interface BulkActivityRow {
  itemNumber: string;
  activity: string;
  acceptanceCriteria: string | null;
  referenceSpec: string | null;
  method: string | null;
  frequency: string | null;
  evidenceType: 1 | 2 | 3;
  plannedDate: string | null;
  /** Party name (as typed in the header) -> level code. */
  levels: Record<string, string>;
}

export interface BulkParseResult {
  rows: BulkActivityRow[];
  error: string | null;
}

export const BULK_FIELD_LIMITS = { itemNumber: 20, activity: 300, text: 2000 } as const;

const HEADER_ALIASES: Record<string, keyof Omit<BulkActivityRow, "levels" | "evidenceType" | "plannedDate"> | "evidence" | "planned"> = {
  item: "itemNumber",
  item_no: "itemNumber",
  item_number: "itemNumber",
  no: "itemNumber",
  number: "itemNumber",
  activity: "activity",
  description: "activity",
  acceptance_criteria: "acceptanceCriteria",
  criteria: "acceptanceCriteria",
  reference_spec: "referenceSpec",
  reference: "referenceSpec",
  spec: "referenceSpec",
  reference_spec_clause: "referenceSpec",
  method: "method",
  frequency: "frequency",
  evidence: "evidence",
  evidence_type: "evidence",
  planned_date: "planned",
  planned: "planned",
  date: "planned",
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function parseEvidenceType(raw: string): 1 | 2 | 3 | null {
  const v = raw.trim().toLowerCase();
  if (!v) return 1;
  if (v === "1" || v.startsWith("check")) return 1;
  if (v === "2" || v.startsWith("doc")) return 2;
  if (v === "3" || v.startsWith("meas")) return 3;
  return null;
}

function parseDate(raw: string): string | null | undefined {
  const v = raw.trim();
  if (!v) return null;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  const iso = dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : v;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? undefined : iso;
}

/**
 * @param partyNames active party names on the project; a header cell equal to one of them (case-insensitive)
 *   is read as that party's sign-off level for the row.
 */
export function parseBulkActivityRows(text: string, partyNames: string[] = []): BulkParseResult {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], error: "Paste at least one row." };

  const partyByNorm = new Map(partyNames.map((p) => [norm(p), p]));
  const firstNorm = table[0].map(norm);
  const hasHeader = firstNorm.some((h) => HEADER_ALIASES[h] === "activity");

  // column index -> field or party
  const fieldAt = new Map<number, string>();
  const partyAt = new Map<number, string>();
  let body = table;
  if (hasHeader) {
    firstNorm.forEach((h, i) => {
      const alias = HEADER_ALIASES[h];
      if (alias) fieldAt.set(i, alias);
      else if (partyByNorm.has(h)) partyAt.set(i, partyByNorm.get(h)!);
    });
    body = table.slice(1);
  } else {
    ["itemNumber", "activity", "acceptanceCriteria", "referenceSpec", "method", "frequency", "evidence", "planned"].forEach((f, i) => fieldAt.set(i, f));
  }
  if (body.length === 0) return { rows: [], error: "Paste at least one row." };

  const rows: BulkActivityRow[] = [];
  for (const [index, cells] of body.entries()) {
    const line = index + 1 + (hasHeader ? 1 : 0);
    const get = (field: string) => {
      for (const [i, f] of fieldAt) if (f === field) return (cells[i] ?? "").trim();
      return "";
    };
    const activity = get("activity");
    if (!activity) return { rows: [], error: `Row ${line}: the activity text is empty.` };
    const itemNumber = get("itemNumber");
    if (itemNumber.length > BULK_FIELD_LIMITS.itemNumber) return { rows: [], error: `Row ${line}: the activity number is too long.` };
    if (activity.length > BULK_FIELD_LIMITS.activity) return { rows: [], error: `Row ${line}: the activity text is longer than ${BULK_FIELD_LIMITS.activity} characters.` };
    for (const f of ["acceptanceCriteria", "referenceSpec", "method", "frequency"]) {
      if (get(f).length > BULK_FIELD_LIMITS.text) return { rows: [], error: `Row ${line}: ${f} is too long.` };
    }
    const evidence = parseEvidenceType(get("evidence"));
    if (evidence === null) return { rows: [], error: `Row ${line}: evidence type must be 1/checklist, 2/document or 3/measurement.` };
    const planned = parseDate(get("planned"));
    if (planned === undefined) return { rows: [], error: `Row ${line}: planned date isn't a valid date (use YYYY-MM-DD or DD/MM/YYYY).` };

    const levels: Record<string, string> = {};
    for (const [i, party] of partyAt) {
      const code = (cells[i] ?? "").trim().toUpperCase();
      if (code) levels[party] = code;
    }
    rows.push({
      itemNumber,
      activity,
      acceptanceCriteria: get("acceptanceCriteria") || null,
      referenceSpec: get("referenceSpec") || null,
      method: get("method") || null,
      frequency: get("frequency") || null,
      evidenceType: evidence,
      plannedDate: planned,
      levels,
    });
  }
  return { rows, error: null };
}
