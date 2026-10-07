// Column maps for the register CSV export / import. `header` is what the file shows; `field` is the
// database column. Import accepts the same headers (matched after lower-casing, non-alphanumerics -> "_").

export type CsvRegisterKind = "calibration" | "welder" | "material" | "personnel";

export interface CsvColumn {
  header: string;
  field: string;
  required?: boolean;
  kind?: "date";
}

export const REGISTER_CSV_COLUMNS: Record<CsvRegisterKind, CsvColumn[]> = {
  calibration: [
    { header: "instrument_name", field: "instrument_name", required: true },
    { header: "instrument_tag", field: "instrument_tag" },
    { header: "calibration_lab", field: "calibration_lab" },
    { header: "cert_number", field: "cert_number", required: true },
    { header: "cal_date", field: "cal_date", kind: "date" },
    { header: "due_date", field: "due_date", required: true, kind: "date" },
    { header: "notes", field: "notes" },
  ],
  welder: [
    { header: "welder_identifier", field: "welder_identifier", required: true },
    { header: "wpq_number", field: "wpq_number" },
    { header: "process", field: "process" },
    { header: "position", field: "position" },
    { header: "qualified_wps", field: "qualified_wps", required: true },
    { header: "qualified_ranges", field: "qualified_ranges" },
    { header: "expiry_date", field: "expiry_date", required: true, kind: "date" },
    { header: "notes", field: "notes" },
  ],
  material: [
    { header: "material_description", field: "material_description", required: true },
    { header: "submittal_reference", field: "submittal_reference" },
    { header: "approval_status", field: "approval_status", required: true },
    { header: "approved_date", field: "approved_date", kind: "date" },
    { header: "heat_number", field: "heat_number" },
    { header: "batch_number", field: "batch_number" },
    { header: "po_reference", field: "po_reference" },
    { header: "supplier", field: "supplier" },
    { header: "quantity", field: "quantity" },
    { header: "certificate_reference", field: "certificate_reference" },
    { header: "notes", field: "notes" },
  ],
  personnel: [
    { header: "party_name", field: "party_name", required: true },
    { header: "certification_type", field: "certification_type", required: true },
    { header: "cert_number", field: "cert_number" },
    { header: "issued_date", field: "issued_date", kind: "date" },
    { header: "expiry_date", field: "expiry_date", required: true, kind: "date" },
    { header: "notes", field: "notes" },
  ],
};
