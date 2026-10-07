import { parseCsvObjects } from "./csv";
import { REGISTER_CSV_COLUMNS, type CsvRegisterKind } from "./csv-columns";
import { computeCalibrationStatus, computePersonnelCertificationStatus, computeWelderStatus } from "./status";
import { MATERIAL_APPROVAL_STATUSES } from "./types";

export const MAX_IMPORT_ROWS = 500;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts YYYY-MM-DD or DD/MM/YYYY (and DD-MM-YYYY); returns ISO or null when it isn't a real date. */
export function normaliseImportDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "";
  let iso = value;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (dmy) iso = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  if (!ISO_DATE.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  const year = Number(iso.slice(0, 4));
  return year < 1990 || year > 2100 ? null : iso;
}

export interface PlannedRegisterImport {
  rows: Record<string, unknown>[];
  /** One message per rejected line, with its line number. */
  errors: string[];
  /** Lines skipped because the same entry already exists (or repeats earlier in the file). */
  duplicates: number;
}

const lc = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** Natural key used to spot an entry that is already in the register (mirrors the unique indexes). */
export function registerImportKey(kind: CsvRegisterKind, r: Record<string, unknown>): string | null {
  if (kind === "calibration") return `${lc(r.cert_number)}|${lc(r.instrument_name)}`;
  if (kind === "welder") return `${lc(r.welder_identifier)}|${lc(r.qualified_wps)}`;
  if (kind === "material") return lc(r.heat_number) ? `${lc(r.heat_number)}|${lc(r.material_description)}` : null;
  return lc(r.cert_number) ? `${String(r.project_party_id)}|${lc(r.certification_type)}|${lc(r.cert_number)}` : null;
}

/**
 * Turns pasted / uploaded CSV text into insertable register rows. Never sets a material's receipt status
 * (imported materials always land as received - pending inspection) and never marks anything verified;
 * both stay with JAGS staff.
 */
export function planRegisterImport(
  kind: CsvRegisterKind,
  text: string,
  opts: { partyIdByName?: Map<string, string>; existingKeys?: Set<string> } = {}
): PlannedRegisterImport {
  const columns = REGISTER_CSV_COLUMNS[kind];
  const { headers, records } = parseCsvObjects(text);
  const out: PlannedRegisterImport = { rows: [], errors: [], duplicates: 0 };

  const missing = columns.filter((c) => c.required && !headers.includes(c.header)).map((c) => c.header);
  if (missing.length > 0) {
    out.errors.push(`Missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
    return out;
  }
  if (records.length > MAX_IMPORT_ROWS) {
    out.errors.push(`Too many rows (${records.length}); import at most ${MAX_IMPORT_ROWS} at a time.`);
    return out;
  }

  const seen = new Set(opts.existingKeys ?? []);
  records.forEach((rec, index) => {
    const line = index + 2; // header is line 1
    const row: Record<string, unknown> = {};
    const problems: string[] = [];

    for (const col of columns) {
      const raw = (rec[col.header] ?? "").trim();
      if (col.required && !raw) {
        problems.push(`${col.header} is required`);
        continue;
      }
      if (col.kind === "date") {
        const iso = normaliseImportDate(raw);
        if (iso === null) problems.push(`${col.header} "${raw}" isn't a valid date (use YYYY-MM-DD or DD/MM/YYYY)`);
        else row[col.field] = iso || null;
      } else {
        row[col.field] = raw.slice(0, 500) || null;
      }
    }

    if (kind === "personnel") {
      const partyId = opts.partyIdByName?.get(lc(row.party_name));
      if (!partyId) problems.push(`party "${String(row.party_name ?? "")}" isn't a party on this project`);
      else row.project_party_id = partyId;
      delete row.party_name;
    }
    if (kind === "material") {
      const approval = String(row.approval_status ?? "").toUpperCase();
      if (!(MATERIAL_APPROVAL_STATUSES as readonly string[]).includes(approval)) problems.push(`approval_status must be A, B, C or D`);
      else row.approval_status = approval;
      row.receipt_status = "received_pending_inspection";
    }
    if (kind === "calibration" && row.cal_date && row.due_date && String(row.due_date) < String(row.cal_date)) problems.push("due_date is before cal_date");

    if (problems.length > 0) {
      out.errors.push(`Line ${line}: ${problems.join("; ")}.`);
      return;
    }

    if (kind === "calibration") row.status = computeCalibrationStatus(String(row.due_date));
    if (kind === "welder") row.status = computeWelderStatus(String(row.expiry_date));
    if (kind === "personnel") row.status = computePersonnelCertificationStatus(String(row.expiry_date));

    const key = registerImportKey(kind, row);
    if (key) {
      if (seen.has(key)) {
        out.duplicates += 1;
        return;
      }
      seen.add(key);
    }
    out.rows.push(row);
  });
  return out;
}
