// Domain enums and types shared between the web app and the background worker.
// These mirror CHECK constraints defined in supabase/migrations — keep in sync by hand,
// since Supabase's generated types describe columns, not the semantic meaning of each value.

export const ACCESS_SCOPE_TYPES = ["global", "organization", "project"] as const;
export type AccessScopeType = (typeof ACCESS_SCOPE_TYPES)[number];

export const PARTY_TYPES = [
  "subcontractor",
  "main_contractor",
  "tpi_lab",
  "vendor",
  "client",
  "jags",
] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const INTERVENTION_LEVELS = ["H", "W", "R", "S"] as const;
export type InterventionLevel = (typeof INTERVENTION_LEVELS)[number];

export const INTERVENTION_LEVEL_LABELS: Record<InterventionLevel, string> = {
  H: "Hold",
  W: "Witness",
  R: "Review",
  S: "Surveillance",
};

export const ENGAGEMENT_MODES = ["jags_led", "co_branded", "white_label"] as const;
export type EngagementMode = (typeof ENGAGEMENT_MODES)[number];

export const OVERALL_RESULTS = ["pass", "fail", "partial"] as const;
export type OverallResult = (typeof OVERALL_RESULTS)[number];

export const CHECKLIST_RESPONSE_RESULTS = ["yes", "no", "na"] as const;
export type ChecklistResponseResult = (typeof CHECKLIST_RESPONSE_RESULTS)[number];

export const NCR_SEVERITIES = ["observation", "minor_ncr", "major_ncr"] as const;
export type NcrSeverity = (typeof NCR_SEVERITIES)[number];

export const NCR_STATUSES = ["open", "in_progress", "pending_verification", "closed"] as const;
export type NcrStatus = (typeof NCR_STATUSES)[number];

export const ASSIGNMENT_TYPES = ["fat", "witness_inspection", "specific_test", "pre_shipment"] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

export const ASSIGNMENT_STATUSES = ["draft", "completed"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const ASSIGNMENT_CONCLUSIONS = ["pass", "conditional_pass", "fail"] as const;
export type AssignmentConclusion = (typeof ASSIGNMENT_CONCLUSIONS)[number];

export const MEASUREMENT_RESULTS = ["pass", "fail"] as const;
export type MeasurementResult = (typeof MEASUREMENT_RESULTS)[number];

export const PUNCH_ITEM_STATUSES = ["open", "closed"] as const;
export type PunchItemStatus = (typeof PUNCH_ITEM_STATUSES)[number];

export const BACKGROUND_JOB_TYPES = ["render_itp_pdf"] as const;
export type BackgroundJobType = (typeof BACKGROUND_JOB_TYPES)[number];

export const BACKGROUND_JOB_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export type BackgroundJobStatus = (typeof BACKGROUND_JOB_STATUSES)[number];

export const SIGNOFF_STATUSES = ["pending", "notified", "signed_off", "proceeded_no_response"] as const;
export type SignoffStatus = (typeof SIGNOFF_STATUSES)[number];

export const VAULT_FOLDER_KEYS = [
  "drawings",
  "specifications",
  "standards_codes",
  "material_submittals",
  "rfis",
  "method_statements",
  "itps_approved",
  "checklists_forms",
  "approvals_correspondence",
  "certificates",
  "general_reference",
] as const;
export type VaultFolderKey = (typeof VAULT_FOLDER_KEYS)[number];

export const VAULT_DOCUMENT_STATUSES = ["for_review", "approved", "superseded"] as const;
export type VaultDocumentStatus = (typeof VAULT_DOCUMENT_STATUSES)[number];

export const NUMBERING_DOC_TYPES = [
  "itp",
  "ncr",
  "checklist",
  "irn",
  "standalone_assignment",
  "vault_document",
] as const;
export type NumberingDocType = (typeof NUMBERING_DOC_TYPES)[number];

export const PUNCH_LIST_SOURCES = [
  "inspection_failure",
  "fat_conditional_pass",
  "ncr",
  "walkdown",
  "manual",
] as const;
export type PunchListSource = (typeof PUNCH_LIST_SOURCES)[number];

export const PUNCH_LIST_STATUSES = ["open", "closed"] as const;
export type PunchListStatus = (typeof PUNCH_LIST_STATUSES)[number];

export const DATA_BOOK_STATUSES = ["draft", "compiled", "issued"] as const;
export type DataBookStatus = (typeof DATA_BOOK_STATUSES)[number];

export const ITP_MASTER_PROPOSED_ACTIONS = ["new_template", "update_existing"] as const;
export type ItpMasterProposedAction = (typeof ITP_MASTER_PROPOSED_ACTIONS)[number];

export const ITP_MASTER_PROPOSAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ItpMasterProposalStatus = (typeof ITP_MASTER_PROPOSAL_STATUSES)[number];

export const CALIBRATION_STATUSES = ["valid", "due_soon", "expired"] as const;
export type CalibrationStatus = (typeof CALIBRATION_STATUSES)[number];

export const WELDER_QUALIFICATION_STATUSES = ["valid", "expiring", "expired"] as const;
export type WelderQualificationStatus = (typeof WELDER_QUALIFICATION_STATUSES)[number];

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

export const AI_FEATURES = ["itp_draft", "ncr_description_draft", "checklist_consistency_check"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
