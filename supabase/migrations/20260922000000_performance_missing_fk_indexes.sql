-- Live performance audit (Supabase performance advisor) found 49 foreign key columns across the
-- app's most-queried tables (itps, ncrs, inspection_records, projects, vault_documents,
-- project_parties, access_grants, punch_list_items, and others) with NO covering index — every join
-- or WHERE on these columns forces a sequential scan instead of an index lookup. This is the biggest
-- concrete, measurable page-load-speed problem the audit surfaced. Several of these are from this
-- session's own additions (vault_documents.approved_by, ncrs.inspection_record_id,
-- ncrs.itp_item_id) — adding the FK without its index is an easy thing to miss, and this migration
-- closes the gap for those plus every pre-existing one the advisor found.
--
-- All `create index if not exists` — purely additive, no risk to existing behavior or data.

create index if not exists access_grants_project_id_idx on public.access_grants (project_id);
create index if not exists activity_party_intervention_project_party_id_idx on public.activity_party_intervention (project_party_id);
create index if not exists activity_signoff_progress_project_party_id_idx on public.activity_signoff_progress (project_party_id);
create index if not exists activity_signoff_progress_signed_off_by_idx on public.activity_signoff_progress (signed_off_by);
create index if not exists ai_usage_log_reviewed_by_idx on public.ai_usage_log (reviewed_by);
create index if not exists ai_usage_log_user_id_idx on public.ai_usage_log (user_id);
create index if not exists checklist_responses_calibration_asset_id_idx on public.checklist_responses (calibration_asset_id);
create index if not exists checklist_responses_checklist_item_id_idx on public.checklist_responses (checklist_item_id);
create index if not exists custom_role_assignments_project_id_idx on public.custom_role_assignments (project_id);
create index if not exists data_books_compiled_by_idx on public.data_books (compiled_by);
create index if not exists data_books_override_by_idx on public.data_books (override_by);
create index if not exists document_sequences_project_id_idx on public.document_sequences (project_id);
create index if not exists drawing_markups_created_by_idx on public.drawing_markups (created_by);
create index if not exists handover_certificates_issued_by_idx on public.handover_certificates (issued_by);
create index if not exists inspection_photos_uploaded_by_idx on public.inspection_photos (uploaded_by);
create index if not exists inspection_records_checklist_template_id_idx on public.inspection_records (checklist_template_id);
create index if not exists inspection_records_inspector_id_idx on public.inspection_records (inspector_id);
create index if not exists irns_issued_by_idx on public.irns (issued_by);
create index if not exists itp_master_proposals_proposed_by_idx on public.itp_master_proposals (proposed_by);
create index if not exists itp_master_proposals_reviewed_by_idx on public.itp_master_proposals (reviewed_by);
create index if not exists itp_master_proposals_source_itp_id_idx on public.itp_master_proposals (source_itp_id);
create index if not exists itp_master_proposals_target_template_id_idx on public.itp_master_proposals (target_template_id);
create index if not exists itp_master_templates_created_by_idx on public.itp_master_templates (created_by);
create index if not exists itp_master_templates_discipline_id_idx on public.itp_master_templates (discipline_id);
create index if not exists itps_approved_by_idx on public.itps (approved_by);
create index if not exists itps_client_accepted_by_idx on public.itps (client_accepted_by);
create index if not exists itps_prepared_by_idx on public.itps (prepared_by);
create index if not exists itps_reviewed_by_idx on public.itps (reviewed_by);
create index if not exists ncr_photos_uploaded_by_idx on public.ncr_photos (uploaded_by);
create index if not exists ncrs_closed_by_idx on public.ncrs (closed_by);
create index if not exists ncrs_inspection_record_id_idx on public.ncrs (inspection_record_id);
create index if not exists ncrs_itp_item_id_idx on public.ncrs (itp_item_id);
create index if not exists ncrs_raised_by_idx on public.ncrs (raised_by);
create index if not exists notifications_organization_id_idx on public.notifications (organization_id);
create index if not exists notifications_project_id_idx on public.notifications (project_id);
create index if not exists numbering_configs_project_id_idx on public.numbering_configs (project_id);
create index if not exists project_parties_discipline_id_idx on public.project_parties (discipline_id);
create index if not exists projects_created_by_idx on public.projects (created_by);
create index if not exists projects_responsible_person_id_idx on public.projects (responsible_person_id);
create index if not exists punch_list_items_closed_by_idx on public.punch_list_items (closed_by);
create index if not exists punch_list_items_responsible_party_id_idx on public.punch_list_items (responsible_party_id);
create index if not exists punch_list_items_source_inspection_record_id_idx on public.punch_list_items (source_inspection_record_id);
create index if not exists punch_list_items_source_ncr_id_idx on public.punch_list_items (source_ncr_id);
create index if not exists punch_list_items_source_standalone_assignment_id_idx on public.punch_list_items (source_standalone_assignment_id);
create index if not exists standalone_assignment_photos_uploaded_by_idx on public.standalone_assignment_photos (uploaded_by);
create index if not exists standalone_assignments_created_by_idx on public.standalone_assignments (created_by);
create index if not exists vault_documents_approved_by_idx on public.vault_documents (approved_by);
create index if not exists vault_documents_superseded_by_idx on public.vault_documents (superseded_by);
create index if not exists vault_documents_uploaded_by_idx on public.vault_documents (uploaded_by);
