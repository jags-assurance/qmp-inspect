// Domain types + table-name handles for the register tables added in
// supabase/migrations/20260910050000_phase3_registers.sql (Reqs R92-R100).
//
// None of these tables are in the generated Database type yet, so `.from()` can't resolve them
// against the Tables map. Casting each table name here is the one place that gap leaks in — same
// approach as NCRS_TABLE in lib/ncrs/types.ts. Every query still gets its real row shape back via
// an explicit `.returns<T>()` / typed `.single<T>()` / `.maybeSingle<T>()`.
//
// The enums below mirror each table's CHECK constraint, the same way packages/shared-types/src/
// domain.ts mirrors the others — they belong there once that file can be touched.
/* eslint-disable @typescript-eslint/no-explicit-any -- narrow, documented escape hatch, see above */
export const CALIBRATION_REGISTER_TABLE = "calibration_register" as any;
export const WELDER_QUALIFICATION_REGISTER_TABLE = "welder_qualification_register" as any;
export const MATERIAL_REGISTER_TABLE = "material_register" as any;
export const PERSONNEL_CERTIFICATIONS_TABLE = "personnel_certifications" as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const CALIBRATION_STATUSES = ["valid", "due_soon", "expired"] as const;
export type CalibrationStatus = (typeof CALIBRATION_STATUSES)[number];

export interface CalibrationRegisterRow {
  id: string;
  project_id: string;
  instrument_name: string;
  cert_number: string;
  cal_date: string | null;
  due_date: string;
  status: CalibrationStatus;
  notes: string | null;
  created_at: string;
}

export const WELDER_QUALIFICATION_STATUSES = ["valid", "expiring", "expired"] as const;
export type WelderQualificationStatus = (typeof WELDER_QUALIFICATION_STATUSES)[number];

export interface WelderQualificationRegisterRow {
  id: string;
  project_id: string;
  welder_identifier: string;
  qualified_wps: string;
  qualified_ranges: string | null;
  expiry_date: string;
  status: WelderQualificationStatus;
  notes: string | null;
  created_at: string;
}

// Standard construction-submittal approval coding: A = approved, B = approved as noted,
// C = revise and resubmit, D = rejected.
export const MATERIAL_APPROVAL_STATUSES = ["A", "B", "C", "D"] as const;
export type MaterialApprovalStatus = (typeof MATERIAL_APPROVAL_STATUSES)[number];

export const MATERIAL_APPROVAL_STATUS_LABELS: Record<MaterialApprovalStatus, string> = {
  A: "Approved",
  B: "Approved as noted",
  C: "Revise and resubmit",
  D: "Rejected",
};

// Receiving-inspection state (distinct from approval_status above, which is a design-review
// concept): a material can be submittal-approved and still arrive damaged, unidentified, or
// without its certificate — receipt_status tracks that physical-delivery gate separately, per
// supabase/migrations/20260920010000_material_traceability_and_tool_linkage.sql.
export const MATERIAL_RECEIPT_STATUSES = ["released", "quarantined_pending_disposition", "on_hold", "received_pending_inspection"] as const;
export type MaterialReceiptStatus = (typeof MATERIAL_RECEIPT_STATUSES)[number];

export const MATERIAL_RECEIPT_STATUS_LABELS: Record<MaterialReceiptStatus, string> = {
  released: "Released",
  received_pending_inspection: "Received — pending inspection",
  quarantined_pending_disposition: "Quarantined — pending disposition",
  on_hold: "On hold",
};

export interface MaterialRegisterRow {
  id: string;
  project_id: string;
  material_description: string;
  submittal_reference: string | null;
  approval_status: MaterialApprovalStatus;
  approved_date: string | null;
  // Traceability identifiers (PO/batch/heat + CoC/MTC) — nullable since not every material tracks
  // all of them (e.g. a bulk consumable may have a batch number but no heat number).
  heat_number: string | null;
  batch_number: string | null;
  po_reference: string | null;
  certificate_reference: string | null;
  receipt_status: MaterialReceiptStatus;
  disposition_notes: string | null;
  notes: string | null;
  created_at: string;
}

// Round-table finding: this app tracked calibration/welder-qualification/material registers but had
// no register for whether the PERSON performing/signing off an inspection actually holds a current,
// valid qualification for that activity type. certification_type is free text (e.g. "AWS CWI",
// "ASNT NDT Level II") since real-world cert schemes vary too widely to enumerate.
export const PERSONNEL_CERTIFICATION_STATUSES = ["valid", "expiring_soon", "expired"] as const;
export type PersonnelCertificationStatus = (typeof PERSONNEL_CERTIFICATION_STATUSES)[number];

export interface PersonnelCertificationRow {
  id: string;
  project_id: string;
  project_party_id: string;
  certification_type: string;
  cert_number: string | null;
  issued_date: string | null;
  expiry_date: string;
  status: PersonnelCertificationStatus;
  notes: string | null;
  created_at: string;
}
