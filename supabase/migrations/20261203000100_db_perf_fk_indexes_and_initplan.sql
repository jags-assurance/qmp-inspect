-- Database performance. NOT YET APPLIED: review, then apply with `pnpm db:push` or in the Supabase SQL editor.
-- Dev and prod share one database, so this applies to production too. Everything here is additive or
-- behaviour-neutral.
-- 1. Covering indexes for every foreign key the Supabase performance advisor lists as unindexed.
--    Plain CREATE INDEX IF NOT EXISTS: the tables are small, so the brief lock is negligible.
-- 2. Seven RLS policies that called auth.uid() per row now use (select auth.uid()), which Postgres
--    evaluates once per statement. The logic is otherwise unchanged.

create index if not exists activity_signoff_progress_rejected_by_idx on public.activity_signoff_progress (rejected_by);
create index if not exists ai_consent_history_changed_by_idx on public.ai_consent_history (changed_by);
create index if not exists calibration_register_supersedes_id_idx on public.calibration_register (supersedes_id);
create index if not exists checklist_responses_fix_assigned_by_idx on public.checklist_responses (fix_assigned_by);
create index if not exists checklist_templates_ai_confirmed_by_idx on public.checklist_templates (ai_confirmed_by);
create index if not exists checklist_templates_archived_by_idx on public.checklist_templates (archived_by);
create index if not exists data_books_supersedes_data_book_id_idx on public.data_books (supersedes_data_book_id);
create index if not exists document_transmittals_organization_id_idx on public.document_transmittals (organization_id);
create index if not exists document_transmittals_sent_by_idx on public.document_transmittals (sent_by);
create index if not exists email_outbox_recipient_user_id_idx on public.email_outbox (recipient_user_id);
create index if not exists handover_certificates_acknowledged_by_idx on public.handover_certificates (acknowledged_by);
create index if not exists handover_certificates_rejected_by_idx on public.handover_certificates (rejected_by);
create index if not exists inbound_email_messages_project_id_idx on public.inbound_email_messages (project_id);
create index if not exists inspection_comments_author_id_idx on public.inspection_comments (author_id);
create index if not exists inspection_comments_resolved_by_idx on public.inspection_comments (resolved_by);
create index if not exists inspection_notice_waivers_waived_by_idx on public.inspection_notice_waivers (waived_by);
create index if not exists inspection_records_reviewed_by_idx on public.inspection_records (reviewed_by);
create index if not exists itp_items_assigned_by_idx on public.itp_items (assigned_by);
create index if not exists itps_master_template_id_idx on public.itps (master_template_id);
create index if not exists itps_superseded_by_itp_id_idx on public.itps (superseded_by_itp_id);
create index if not exists material_register_supersedes_id_idx on public.material_register (supersedes_id);
create index if not exists ncr_root_cause_categories_organization_id_idx on public.ncr_root_cause_categories (organization_id);
create index if not exists ncrs_capa_updated_by_idx on public.ncrs (capa_updated_by);
create index if not exists ncrs_client_accepted_by_idx on public.ncrs (client_accepted_by);
create index if not exists ncrs_duplicate_of_ncr_id_idx on public.ncrs (duplicate_of_ncr_id);
create index if not exists ncrs_withdrawn_by_idx on public.ncrs (withdrawn_by);
create index if not exists org_retention_settings_updated_by_idx on public.org_retention_settings (updated_by);
create index if not exists organizations_ai_consent_by_idx on public.organizations (ai_consent_by);
create index if not exists orphan_photo_flags_inspection_record_id_idx on public.orphan_photo_flags (inspection_record_id);
create index if not exists orphan_photo_flags_project_id_idx on public.orphan_photo_flags (project_id);
create index if not exists orphan_photo_flags_reviewed_by_idx on public.orphan_photo_flags (reviewed_by);
create index if not exists personnel_certifications_holder_user_id_idx on public.personnel_certifications (holder_user_id);
create index if not exists personnel_certifications_supersedes_id_idx on public.personnel_certifications (supersedes_id);
create index if not exists projects_closed_by_idx on public.projects (closed_by);
create index if not exists punch_list_items_withdrawn_by_idx on public.punch_list_items (withdrawn_by);
create index if not exists register_certificate_history_replaced_by_idx on public.register_certificate_history (replaced_by);
create index if not exists seat_limit_overrides_granted_by_idx on public.seat_limit_overrides (granted_by);
create index if not exists seat_limit_overrides_user_id_idx on public.seat_limit_overrides (user_id);
create index if not exists vault_retention_flags_reviewed_by_idx on public.vault_retention_flags (reviewed_by);
create index if not exists walkdowns_created_by_idx on public.walkdowns (created_by);
create index if not exists walkdowns_signed_off_by_idx on public.walkdowns (signed_off_by);
create index if not exists welder_qualification_register_supersedes_id_idx on public.welder_qualification_register (supersedes_id);

alter policy background_jobs_insert_requester on public.background_jobs
  with check (is_system_caller() OR ((payload ->> 'requested_by'::text) = ((select auth.uid()))::text));

alter policy walkdowns_update on public.walkdowns
  using ((EXISTS (SELECT 1 FROM projects p WHERE ((p.id = walkdowns.project_id) AND has_project_access(p.id, p.organization_id)))) AND ((created_by = (select auth.uid())) OR is_admin_staff()))
  with check ((EXISTS (SELECT 1 FROM projects p WHERE ((p.id = walkdowns.project_id) AND has_project_access(p.id, p.organization_id)))) AND ((created_by = (select auth.uid())) OR is_admin_staff()));

alter policy register_certificate_history_insert on public.register_certificate_history
  with check (is_jags_staff() AND (replaced_by = (select auth.uid())) AND (EXISTS (SELECT 1 FROM projects p WHERE ((p.id = register_certificate_history.project_id) AND has_project_access(p.id, p.organization_id)))));

alter policy document_transmittals_insert on public.document_transmittals
  with check ((sent_by = (select auth.uid())) AND (status = 'queued'::text) AND is_jags_staff() AND has_project_access(project_id, organization_id) AND (EXISTS (SELECT 1 FROM projects p WHERE ((p.id = document_transmittals.project_id) AND (p.organization_id = document_transmittals.organization_id)))) AND (((entity_type = 'vault_document'::text) AND (EXISTS (SELECT 1 FROM vault_documents d JOIN vault_folders f ON ((f.id = d.folder_id)) WHERE ((d.id = document_transmittals.entity_id) AND (f.project_id = document_transmittals.project_id) AND (d.status = 'approved'::text))))) OR ((entity_type = 'data_book'::text) AND (EXISTS (SELECT 1 FROM data_books b WHERE ((b.id = document_transmittals.entity_id) AND (b.project_id = document_transmittals.project_id) AND (b.status = 'issued'::text)))))));

alter policy inspection_notice_waivers_insert on public.inspection_notice_waivers
  with check (is_jags_staff() AND (waived_by = (select auth.uid())) AND (EXISTS (SELECT 1 FROM inspection_records r JOIN projects p ON ((p.id = r.project_id)) WHERE ((r.id = inspection_notice_waivers.inspection_record_id) AND (r.project_id = inspection_notice_waivers.project_id) AND (r.overall_result IS NULL) AND has_project_access(p.id, p.organization_id)))));

alter policy inspection_comments_insert on public.inspection_comments
  with check ((author_id = (select auth.uid())) AND (EXISTS (SELECT 1 FROM inspection_records r JOIN projects p ON ((p.id = r.project_id)) WHERE ((r.id = inspection_comments.inspection_record_id) AND (r.project_id = inspection_comments.project_id) AND (r.overall_result IS NOT NULL) AND has_project_access(p.id, p.organization_id)))));

alter policy inspection_comments_update on public.inspection_comments
  using (((author_id = (select auth.uid())) OR is_jags_staff()) AND (EXISTS (SELECT 1 FROM projects p WHERE ((p.id = inspection_comments.project_id) AND has_project_access(p.id, p.organization_id)))))
  with check (((author_id = (select auth.uid())) OR is_jags_staff()) AND (EXISTS (SELECT 1 FROM projects p WHERE ((p.id = inspection_comments.project_id) AND has_project_access(p.id, p.organization_id)))));
