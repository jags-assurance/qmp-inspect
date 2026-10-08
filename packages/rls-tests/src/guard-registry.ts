/**
 * Guard -> test registry. Every database write guard found in supabase/migrations (from
 * FIRST_MIGRATION onward, see migration-scan.ts) must have an entry here, saying which live test
 * proves it or why none exists yet. coverage.test.ts (offline, runs anywhere) fails when a guard is
 * added to the migrations without an entry, so a missing test is always visible rather than silent.
 *
 *   covered           proved by src/write-guards.test.ts: a wrong-role check that must be REFUSED and a
 *                     right-role check that must SUCCEED, both under `guard("<name>")` (the suite fails
 *                     at run time if it did not execute at least one of each)
 *   covered-existing  proved by an older suite (guards.test.ts section N, or tenant-isolation.test.ts)
 *   not-a-guard       a trigger that stamps / syncs / logs but refuses nothing; kept here so the scan is exhaustive
 *   gap               no live test yet; `note` says why. Gaps are listed in GUARD_COVERAGE.md, never hidden.
 */
import type { GuardKind } from "./migration-scan";

export type CoverageStatus = "covered" | "covered-existing" | "not-a-guard" | "gap";

export interface GuardEntry {
  kind: GuardKind;
  name: string;
  status: CoverageStatus;
  /** covered: the write-guards.test.ts section; covered-existing: "guards.test.ts section N". */
  where: string;
  /** Required for gap / not-a-guard / partial coverage. */
  note?: string;
  /** One line: what the guard enforces (shown in the table). */
  rule: string;
}

const T = (name: string, status: CoverageStatus, where: string, rule: string, note?: string): GuardEntry => ({ kind: "trigger_fn", name, status, where, rule, note });
const U = (name: string, status: CoverageStatus, where: string, rule: string, note?: string): GuardEntry => ({ kind: "unique_index", name, status, where, rule, note });
const P = (name: string, status: CoverageStatus, where: string, rule: string, note?: string): GuardEntry => ({ kind: "policy_table", name, status, where, rule, note });

export const GUARD_REGISTRY: GuardEntry[] = [
  // ---- trigger functions -------------------------------------------------------------------------
  T("access_grants_protect_last_admin", "gap", "-", "the last active Admin grant cannot be removed", "Only fires when the final Admin of the whole project is removed; cannot be provoked on a shared database (see guards.test.ts header)."),
  T("activity_signoff_progress_guard", "covered", "W12", "only the linked party, an admin or a team lead signs off; only an admin or lead withdraws a recorded sign-off"),
  T("auth_users_default_must_change_claim", "not-a-guard", "-", "sets the default must-change-password claim on new auth users", "Defaults a claim; refuses nothing."),
  T("background_jobs_set_started_at", "not-a-guard", "-", "stamps started_at when a job moves to running", "Bookkeeping stamp; refuses nothing."),
  T("checklist_items_freeze_guard", "covered", "W12", "checklist items freeze once any inspection response exists"),
  T("checklist_responses_keep_history", "covered-existing", "guards.test.ts section 8", "keeps the previous answer in checklist_response_history"),
  T("checklist_templates_delete_guard", "covered", "W12", "a checklist with inspection records is archived, never deleted"),
  T("data_books_guard", "covered", "W11", "Data Book status moves only through the compile / withdraw / issue RPCs; issued books are immutable"),
  T("data_books_set_revision", "not-a-guard", "-", "assigns the next Data Book revision number", "Assigns a number; refuses nothing."),
  T("enforce_access_grants_org_seat_limit", "covered-existing", "guards.test.ts section 11", "no grant beyond the organisation's seat limit without a single-use Admin override"),
  T("inspection_amendment_authority_guard", "covered", "W12", "re-opening a completed inspection needs an admin or a team lead on the project"),
  T("inspection_child_exec_guard", "covered", "W12", "only staff or the assigned executing party record answers / photos on an inspection"),
  T("inspection_child_write_guard", "covered", "W12", "answers and evidence links are frozen once the inspection is completed"),
  T("inspection_comments_guard", "covered", "W4", "reviewer comments: completed inspections only, author forced, 15-minute edit window, staff-only resolve, one-level threads"),
  T("inspection_records_ai_draft_guard", "gap", "-", "an inspection cannot start from an AI-drafted checklist that is still unconfirmed", "Needs an AI-draft checklist fixture (ai_status columns); not built yet."),
  T("inspection_records_block_pending_revision", "gap", "-", "no new inspection while the ITP has a revision awaiting approval", "Needs an ITP with revision_needs_approval and its approval chain; not built yet."),
  T("inspection_records_exec_guard", "covered", "W12", "only staff or the assigned party start / complete an inspection; completion needs signature, answers, matching result, evidence"),
  T("inspection_records_write_guard", "covered", "W12", "a completed inspection can only be re-opened (staff) or have its narrative edited; it cannot be deleted"),
  T("irns_issue_gates_guard", "covered", "W10", "no IRN while an NCR raised from the inspection is open (also open Hold / mandatory N/A)", "Open-NCR gate is tested live; the open-Hold and mandatory-N/A gates are not (they need hold-point and partial-result fixtures)."),
  T("irns_write_guard", "covered", "W10", "IRN insert only from a passed inspection, issuer forced, immutable except voiding with a reason, never deleted"),
  T("itp_children_block_terminal", "covered", "W14", "ITP sections / items are read-only once the ITP is withdrawn or superseded"),
  T("itp_sections_protect_history", "gap", "-", "ITP sections that carry history cannot be deleted", "Needs sections with recorded revision history; not built yet."),
  T("itps_guard_status_transition", "covered", "W14", "ITP status only moves along the allowed lifecycle"),
  T("ncr_evidence_write_guard", "covered", "W7", "NCR evidence: only people who work the NCR, never when closed or awaiting verification, photo path scoped to the NCR"),
  T("ncrs_client_acceptance_guard", "covered-existing", "guards.test.ts section 10", "client acceptance flag / decision rules and the close gate"),
  T("ncrs_enforce_workflow", "covered", "W7", "NCR status machine, close / re-open authority, CAPA and evidence preconditions, column locks"),
  T("ncrs_force_raised_by", "covered", "W6", "a new NCR is always open and raised by the caller; links must belong to the project"),
  T("ncrs_guard_delete", "covered", "W8", "only admin staff delete an NCR, never a closed one"),
  T("notifications_enqueue_email", "not-a-guard", "-", "queues the email for a notification", "Queues an email; refuses nothing."),
  T("notifications_set_sender", "gap", "-", "the sender of a notification is forced to the caller", "Small and cheap to add; not done yet."),
  T("organizations_column_guard", "covered-existing", "guards.test.ts section 6", "only an Admin changes an organisation; org-wide client users of a self-managed org may change the brand colour only"),
  T("organizations_log_ai_consent", "not-a-guard", "-", "logs AI consent changes to ai_consent_history", "Audit logging; refuses nothing."),
  T("organizations_stamp_ai_consent", "not-a-guard", "-", "stamps who changed AI consent and when", "Stamping; refuses nothing."),
  T("project_parties_enforce_type_limit", "covered", "W3", "at most N active parties per type on one project, enforced for every caller"),
  T("project_write_guard", "covered", "W2", "no writes by non-admins on a completed or cancelled project"),
  T("projects_column_guard", "covered", "W1", "a non-Admin may change only the descriptive project columns"),
  T("projects_status_guard", "covered", "W2", "closing needs no open items (or the close_project override); only admin staff re-open"),
  T("punch_list_items_guard_insert", "covered", "W9", "a new punch item starts open, creator forced, links must belong to the project"),
  T("punch_list_items_guard_transition", "covered", "W9", "punch status machine: resolve needs evidence, close / re-open need a verifier, different person closes"),
  T("punch_reopen_ncr_closed_guard", "covered", "W9", "a punch item from an NCR cannot be re-opened while the NCR is closed"),
  T("register_guard_delete_used", "gap", "-", "a register entry that an ITP uses cannot be deleted", "Needs register + ITP requirement fixtures; not built yet."),
  T("register_guard_verification", "gap", "-", "register verification fields are server-owned", "Needs register fixtures; not built yet."),
  T("register_itp_write_guard", "gap", "-", "register links on ITP items follow ITP rules", "Needs register fixtures; not built yet."),
  T("restrict_self_managed_org_update", "covered-existing", "guards.test.ts section 6", "superseded by organizations_column_guard (same table, same rule)", "Replaced by organizations_column_guard in 20261113000700; section 6 exercises the live behaviour."),
  T("standalone_assignments_lifecycle_guard", "covered", "W13", "standalone assignment status machine; completed is locked; only an admin re-opens"),
  T("standalone_child_write_guard", "covered", "W13", "assignment measurements / photos / signatures only while the parent is open"),
  T("sync_signoff_on_intervention_change", "not-a-guard", "-", "keeps activity_signoff_progress in step with intervention changes", "Sync trigger; refuses nothing."),
  T("users_guard_privileged_columns", "covered-existing", "guards.test.ts section 1", "a user cannot change their own staff / active / email / password-change flags"),
  T("users_protect_last_admin", "gap", "-", "the last active Admin cannot be demoted or deactivated", "Same limitation as access_grants_protect_last_admin."),
  T("vault_documents_guard_immutable", "covered", "W14", "approved / superseded vault documents are controlled: no file swap, only superseded by staff / approver / newer revision"),
  T("vault_documents_guard_insert", "covered", "W14", "uploads by non-approvers start for_review; generated documents are filed only by the system"),

  // ---- unique indexes ----------------------------------------------------------------------------
  U("calibration_register_active_unique", "gap", "-", "one active calibration entry per item", "Register fixtures not built yet."),
  U("data_books_one_open_per_project_uidx", "covered", "W11", "one non-issued Data Book per project"),
  U("data_books_project_revision_uidx", "covered", "W11", "unique Data Book revision per project", "A second open book hits this index before the one-open-book index; the test asserts the 23505 refusal, not which of the two fired."),
  U("email_outbox_transmittal_uidx", "gap", "-", "one outbox email per transmittal recipient", "Transmittal fixtures not built yet."),
  U("handover_certificates_verification_token_uidx", "gap", "-", "verification tokens are unique", "Tokens are random 64-char values; a clash cannot be provoked meaningfully."),
  U("irns_project_number_key", "covered", "W10", "one IRN number per project"),
  U("irns_verification_token_uidx", "gap", "-", "verification tokens are unique", "Tokens are random 64-char values; a clash cannot be provoked meaningfully."),
  U("material_register_active_unique", "gap", "-", "one active material entry per item", "Register fixtures not built yet."),
  U("ncr_root_cause_categories_code_uidx", "gap", "-", "unique root-cause category code", "Reference data; not tested."),
  U("ncrs_project_request_id_uidx", "covered", "W5", "an NCR raised twice with the same request_id in one project is refused (the retry returns the first)"),
  U("personnel_cert_active_unique", "gap", "-", "one active certification per person and type", "Register fixtures not built yet."),
  U("punch_list_items_request_uidx", "covered", "W9", "a punch item created twice with the same client_request_id in one project is refused"),
  U("standalone_assignment_measurements_client_key_uidx", "covered", "W13", "an offline measurement replay with the same client_key is refused"),
  U("standalone_assignment_signatures_client_key_uidx", "gap", "-", "an offline signature replay with the same client_key is refused", "Same mechanism as the measurement index, which is tested."),
  U("vault_documents_one_approved_per_ref", "covered", "W14", "one approved document per folder and document reference"),
  U("welder_register_active_unique", "gap", "-", "one active welder qualification per welder and process", "Register fixtures not built yet."),

  // ---- tables with write policies ----------------------------------------------------------------
  P("access_grants", "covered-existing", "guards.test.ts section 2", "who may create / change / remove access grants"),
  P("activity_expected_records", "gap", "-", "who may write expected-record rules on ITP activities", "Not exercised by any live test."),
  P("activity_party_intervention", "gap", "-", "who may assign parties to activities", "Used as a fixture (service role); the policy itself is not probed."),
  P("audit_log", "gap", "-", "who may append audit events", "Not exercised by any live test."),
  P("background_jobs", "gap", "-", "who may queue background jobs", "tenant-isolation.test.ts reads them cross-tenant; the insert policies are not probed."),
  P("data_books", "covered", "W11", "who may create / change / delete Data Books"),
  P("document_transmittals", "gap", "-", "who may record a transmittal", "Not exercised by any live test."),
  P("inspection_comments", "covered", "W4", "who may comment / edit / resolve; no delete"),
  P("inspection_notice_waivers", "covered-existing", "guards.test.ts section 9", "who may waive a witness / hold notice"),
  P("inspection_records", "covered", "W12", "who may delete an inspection record (open drafts only, staff)"),
  P("irns", "covered", "W10", "who may issue / void an IRN; no delete"),
  P("itp_review_progress_history", "gap", "-", "who may append review history", "Not exercised by any live test."),
  P("ncr_root_cause_categories", "gap", "-", "who may edit root-cause categories", "Reference data; not tested."),
  P("ncrs", "covered", "W8", "who may delete an NCR (admin staff, not closed)"),
  P("notifications", "gap", "-", "who may create notifications", "Not exercised by any live test."),
  P("org_retention_settings", "gap", "-", "who may change retention settings", "Not exercised by any live test."),
  P("organizations", "covered-existing", "guards.test.ts section 6", "who may update an organisation"),
  P("projects", "covered", "W1", "who may update a project (Admin staff, or a self-managed org's own users for descriptive columns)", "Project delete is covered by guards.test.ts section 7."),
  P("punch_list_items", "covered", "W9", "who may create / change / delete punch items"),
  P("register_certificate_history", "gap", "-", "who may append register certificate history", "Not exercised by any live test."),
  P("seat_limit_overrides", "covered-existing", "guards.test.ts section 11", "Admin-only create / delete of seat overrides"),
  P("standalone_assignments", "covered", "W13", "who may create / change / delete standalone assignments"),
  P("storage.objects", "covered-existing", "guards.test.ts section 4", "storage write policies (evidence path scope, handover package folder, etc.)", "Evidence-bucket path scope is covered; the generated-documents / registers / transmittal storage policies are not."),
  P("users", "covered-existing", "guards.test.ts section 1", "staff-only user insert / delete"),
  P("walkdowns", "gap", "-", "who may create / update walkdowns", "Not exercised by any live test."),
];
