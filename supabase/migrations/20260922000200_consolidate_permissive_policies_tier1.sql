-- Live performance audit finding: 402 "multiple permissive policies" warnings across ~67
-- (table, command) groups — Postgres must evaluate and OR together every permissive policy that
-- matches a query's command, so a table with a `_write` (FOR ALL) policy sitting alongside a
-- dedicated `_select` policy pays for two policy evaluations on every SELECT, even though one
-- would do. This migration is Tier 1: the ~35 tables that follow the exact same simple pattern —
-- one `_write` (ALL) + one `_select` (SELECT-only), nothing else overlapping.
--
-- Fix, applied uniformly and safely:
--   1. Fold the write policy's condition into the select policy via OR — guarantees select stays
--      at least as permissive as before (nobody loses read access), even in cases where write's
--      condition isn't a strict logical subset of select's.
--   2. Split the write policy into three single-command policies (INSERT/UPDATE/DELETE) instead of
--      FOR ALL — Postgres's CREATE POLICY doesn't accept a comma-separated command list, so "narrow
--      write to not include SELECT" means one policy per remaining command, not one multi-command
--      policy.
--
-- This is a pure policy-shape change — every qual/with_check expression is copied verbatim from
-- the live policies this replaced (extracted via pg_policies), no access-control logic changed.
-- Verified via a second performance-advisor pass (0 remaining multiple_permissive_policies for
-- these 35 tables) and a security-advisor pass (no new findings), plus a live smoke test (ITP
-- register, project detail/parties, custom roles all render correctly post-migration).

-- activity_expected_records
drop policy activity_expected_records_select on public.activity_expected_records;
create policy activity_expected_records_select on public.activity_expected_records
  for select using (
    ((EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((it.id = activity_expected_records.itp_item_id) AND has_project_access(p.id, p.organization_id)))))
    or ((is_jags_staff() OR (EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN project_parties pp ON ((pp.project_id = i.project_id)))
  WHERE ((it.id = activity_expected_records.itp_item_id) AND (pp.user_id = ( SELECT auth.uid() AS uid)) AND (((activity_expected_records.provider = 'jags'::text) AND (pp.party_type = 'jags'::text)) OR ((activity_expected_records.provider = 'tpi'::text) AND (pp.party_type = 'tpi_lab'::text)) OR ((activity_expected_records.provider = 'contractor'::text) AND (pp.party_type = ANY (ARRAY['main_contractor'::text, 'subcontractor'::text])))))))))
  );

drop policy activity_expected_records_write on public.activity_expected_records;
create policy activity_expected_records_write_i on public.activity_expected_records for insert with check ((is_jags_staff() OR (EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN project_parties pp ON ((pp.project_id = i.project_id)))
  WHERE ((it.id = activity_expected_records.itp_item_id) AND (pp.user_id = ( SELECT auth.uid() AS uid)) AND (((activity_expected_records.provider = 'jags'::text) AND (pp.party_type = 'jags'::text)) OR ((activity_expected_records.provider = 'tpi'::text) AND (pp.party_type = 'tpi_lab'::text)) OR ((activity_expected_records.provider = 'contractor'::text) AND (pp.party_type = ANY (ARRAY['main_contractor'::text, 'subcontractor'::text])))))))));
create policy activity_expected_records_write_u on public.activity_expected_records for update using ((is_jags_staff() OR (EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN project_parties pp ON ((pp.project_id = i.project_id)))
  WHERE ((it.id = activity_expected_records.itp_item_id) AND (pp.user_id = ( SELECT auth.uid() AS uid)) AND (((activity_expected_records.provider = 'jags'::text) AND (pp.party_type = 'jags'::text)) OR ((activity_expected_records.provider = 'tpi'::text) AND (pp.party_type = 'tpi_lab'::text)) OR ((activity_expected_records.provider = 'contractor'::text) AND (pp.party_type = ANY (ARRAY['main_contractor'::text, 'subcontractor'::text]))))))))) with check ((is_jags_staff() OR (EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN project_parties pp ON ((pp.project_id = i.project_id)))
  WHERE ((it.id = activity_expected_records.itp_item_id) AND (pp.user_id = ( SELECT auth.uid() AS uid)) AND (((activity_expected_records.provider = 'jags'::text) AND (pp.party_type = 'jags'::text)) OR ((activity_expected_records.provider = 'tpi'::text) AND (pp.party_type = 'tpi_lab'::text)) OR ((activity_expected_records.provider = 'contractor'::text) AND (pp.party_type = ANY (ARRAY['main_contractor'::text, 'subcontractor'::text])))))))));
create policy activity_expected_records_write_d on public.activity_expected_records for delete using ((is_jags_staff() OR (EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN project_parties pp ON ((pp.project_id = i.project_id)))
  WHERE ((it.id = activity_expected_records.itp_item_id) AND (pp.user_id = ( SELECT auth.uid() AS uid)) AND (((activity_expected_records.provider = 'jags'::text) AND (pp.party_type = 'jags'::text)) OR ((activity_expected_records.provider = 'tpi'::text) AND (pp.party_type = 'tpi_lab'::text)) OR ((activity_expected_records.provider = 'contractor'::text) AND (pp.party_type = ANY (ARRAY['main_contractor'::text, 'subcontractor'::text])))))))));

-- activity_party_intervention
drop policy activity_party_intervention_select on public.activity_party_intervention;
create policy activity_party_intervention_select on public.activity_party_intervention
  for select using (
    ((EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((it.id = activity_party_intervention.itp_item_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((it.id = activity_party_intervention.itp_item_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status))))))
  );

drop policy activity_party_intervention_write on public.activity_party_intervention;
create policy activity_party_intervention_write_i on public.activity_party_intervention for insert with check ((EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((it.id = activity_party_intervention.itp_item_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status))))));
create policy activity_party_intervention_write_u on public.activity_party_intervention for update using ((EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((it.id = activity_party_intervention.itp_item_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status)))))) with check ((EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((it.id = activity_party_intervention.itp_item_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status))))));
create policy activity_party_intervention_write_d on public.activity_party_intervention for delete using ((EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((it.id = activity_party_intervention.itp_item_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status))))));

-- activity_signoff_progress
drop policy activity_signoff_progress_select on public.activity_signoff_progress;
create policy activity_signoff_progress_select on public.activity_signoff_progress
  for select using (
    ((EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((it.id = activity_signoff_progress.itp_item_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((it.id = activity_signoff_progress.itp_item_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy activity_signoff_progress_write on public.activity_signoff_progress;
create policy activity_signoff_progress_write_i on public.activity_signoff_progress for insert with check ((EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((it.id = activity_signoff_progress.itp_item_id) AND has_project_access(p.id, p.organization_id)))));
create policy activity_signoff_progress_write_u on public.activity_signoff_progress for update using ((EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((it.id = activity_signoff_progress.itp_item_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((it.id = activity_signoff_progress.itp_item_id) AND has_project_access(p.id, p.organization_id)))));
create policy activity_signoff_progress_write_d on public.activity_signoff_progress for delete using ((EXISTS ( SELECT 1
   FROM (((itp_items it
     JOIN itp_sections s ON ((s.id = it.section_id)))
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((it.id = activity_signoff_progress.itp_item_id) AND has_project_access(p.id, p.organization_id)))));

-- calibration_register
drop policy calibration_register_select on public.calibration_register;
create policy calibration_register_select on public.calibration_register
  for select using (
    ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = calibration_register.project_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = calibration_register.project_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy calibration_register_write on public.calibration_register;
create policy calibration_register_write_i on public.calibration_register for insert with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = calibration_register.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy calibration_register_write_u on public.calibration_register for update using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = calibration_register.project_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = calibration_register.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy calibration_register_write_d on public.calibration_register for delete using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = calibration_register.project_id) AND has_project_access(p.id, p.organization_id)))));

-- checklist_responses
drop policy checklist_responses_select on public.checklist_responses;
create policy checklist_responses_select on public.checklist_responses
  for select using (
    ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = checklist_responses.inspection_record_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = checklist_responses.inspection_record_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy checklist_responses_write on public.checklist_responses;
create policy checklist_responses_write_i on public.checklist_responses for insert with check ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = checklist_responses.inspection_record_id) AND has_project_access(p.id, p.organization_id)))));
create policy checklist_responses_write_u on public.checklist_responses for update using ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = checklist_responses.inspection_record_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = checklist_responses.inspection_record_id) AND has_project_access(p.id, p.organization_id)))));
create policy checklist_responses_write_d on public.checklist_responses for delete using ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = checklist_responses.inspection_record_id) AND has_project_access(p.id, p.organization_id)))));

-- client_team_members
drop policy client_team_members_select on public.client_team_members;
create policy client_team_members_select on public.client_team_members
  for select using (
    ((is_admin_staff() OR (EXISTS ( SELECT 1
   FROM client_teams ct
  WHERE ((ct.id = client_team_members.client_team_id) AND has_org_access(ct.organization_id))))))
    or ((is_admin_staff() OR is_client_team_lead_of(client_team_id)))
  );

drop policy client_team_members_write on public.client_team_members;
create policy client_team_members_write_i on public.client_team_members for insert with check ((is_admin_staff() OR is_client_team_lead_of(client_team_id) OR can_bootstrap_client_team_members(client_team_id)));
create policy client_team_members_write_u on public.client_team_members for update using ((is_admin_staff() OR is_client_team_lead_of(client_team_id))) with check ((is_admin_staff() OR is_client_team_lead_of(client_team_id) OR can_bootstrap_client_team_members(client_team_id)));
create policy client_team_members_write_d on public.client_team_members for delete using ((is_admin_staff() OR is_client_team_lead_of(client_team_id)));

-- client_team_project_assignments
drop policy client_team_project_assignments_select on public.client_team_project_assignments;
create policy client_team_project_assignments_select on public.client_team_project_assignments
  for select using (
    ((is_admin_staff() OR (EXISTS ( SELECT 1
   FROM client_teams ct
  WHERE ((ct.id = client_team_project_assignments.client_team_id) AND has_org_access(ct.organization_id))))))
    or ((is_admin_staff() OR is_client_team_lead_of(client_team_id)))
  );

drop policy client_team_project_assignments_write on public.client_team_project_assignments;
create policy client_team_project_assignments_write_i on public.client_team_project_assignments for insert with check ((is_admin_staff() OR is_client_team_lead_of(client_team_id) OR can_bootstrap_client_team_members(client_team_id)));
create policy client_team_project_assignments_write_u on public.client_team_project_assignments for update using ((is_admin_staff() OR is_client_team_lead_of(client_team_id))) with check ((is_admin_staff() OR is_client_team_lead_of(client_team_id) OR can_bootstrap_client_team_members(client_team_id)));
create policy client_team_project_assignments_write_d on public.client_team_project_assignments for delete using ((is_admin_staff() OR is_client_team_lead_of(client_team_id)));

-- client_teams
drop policy client_teams_select on public.client_teams;
create policy client_teams_select on public.client_teams
  for select using (
    ((is_admin_staff() OR has_org_access(organization_id)))
    or ((is_admin_staff() OR is_client_team_lead_of(id)))
  );

drop policy client_teams_write on public.client_teams;
create policy client_teams_write_i on public.client_teams for insert with check ((is_admin_staff() OR is_client_team_lead_of(id) OR can_bootstrap_client_team(organization_id)));
create policy client_teams_write_u on public.client_teams for update using ((is_admin_staff() OR is_client_team_lead_of(id))) with check ((is_admin_staff() OR is_client_team_lead_of(id) OR can_bootstrap_client_team(organization_id)));
create policy client_teams_write_d on public.client_teams for delete using ((is_admin_staff() OR is_client_team_lead_of(id)));

-- data_books
drop policy data_books_select on public.data_books;
create policy data_books_select on public.data_books
  for select using (
    ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = data_books.project_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = data_books.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))))
  );

drop policy data_books_write on public.data_books;
create policy data_books_write_i on public.data_books for insert with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = data_books.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))));
create policy data_books_write_u on public.data_books for update using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = data_books.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = data_books.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))));
create policy data_books_write_d on public.data_books for delete using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = data_books.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))));

-- drawing_markups
drop policy drawing_markups_select on public.drawing_markups;
create policy drawing_markups_select on public.drawing_markups
  for select using (
    ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = drawing_markups.project_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = drawing_markups.project_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy drawing_markups_write on public.drawing_markups;
create policy drawing_markups_write_i on public.drawing_markups for insert with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = drawing_markups.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy drawing_markups_write_u on public.drawing_markups for update using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = drawing_markups.project_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = drawing_markups.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy drawing_markups_write_d on public.drawing_markups for delete using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = drawing_markups.project_id) AND has_project_access(p.id, p.organization_id)))));

-- handover_certificates
drop policy handover_certificates_select on public.handover_certificates;
create policy handover_certificates_select on public.handover_certificates
  for select using (
    ((EXISTS ( SELECT 1
   FROM (data_books db
     JOIN projects p ON ((p.id = db.project_id)))
  WHERE ((db.id = handover_certificates.data_book_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM (data_books db
     JOIN projects p ON ((p.id = db.project_id)))
  WHERE ((db.id = handover_certificates.data_book_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))))
  );

drop policy handover_certificates_write on public.handover_certificates;
create policy handover_certificates_write_i on public.handover_certificates for insert with check ((EXISTS ( SELECT 1
   FROM (data_books db
     JOIN projects p ON ((p.id = db.project_id)))
  WHERE ((db.id = handover_certificates.data_book_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))));
create policy handover_certificates_write_u on public.handover_certificates for update using ((EXISTS ( SELECT 1
   FROM (data_books db
     JOIN projects p ON ((p.id = db.project_id)))
  WHERE ((db.id = handover_certificates.data_book_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM (data_books db
     JOIN projects p ON ((p.id = db.project_id)))
  WHERE ((db.id = handover_certificates.data_book_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))));
create policy handover_certificates_write_d on public.handover_certificates for delete using ((EXISTS ( SELECT 1
   FROM (data_books db
     JOIN projects p ON ((p.id = db.project_id)))
  WHERE ((db.id = handover_certificates.data_book_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))));

-- inspection_photos
drop policy inspection_photos_select on public.inspection_photos;
create policy inspection_photos_select on public.inspection_photos
  for select using (
    ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = inspection_photos.inspection_record_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = inspection_photos.inspection_record_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy inspection_photos_write on public.inspection_photos;
create policy inspection_photos_write_i on public.inspection_photos for insert with check ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = inspection_photos.inspection_record_id) AND has_project_access(p.id, p.organization_id)))));
create policy inspection_photos_write_u on public.inspection_photos for update using ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = inspection_photos.inspection_record_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = inspection_photos.inspection_record_id) AND has_project_access(p.id, p.organization_id)))));
create policy inspection_photos_write_d on public.inspection_photos for delete using ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = inspection_photos.inspection_record_id) AND has_project_access(p.id, p.organization_id)))));

-- inspection_records
drop policy inspection_records_select on public.inspection_records;
create policy inspection_records_select on public.inspection_records
  for select using (
    ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = inspection_records.project_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = inspection_records.project_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy inspection_records_write on public.inspection_records;
create policy inspection_records_write_i on public.inspection_records for insert with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = inspection_records.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy inspection_records_write_u on public.inspection_records for update using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = inspection_records.project_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = inspection_records.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy inspection_records_write_d on public.inspection_records for delete using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = inspection_records.project_id) AND has_project_access(p.id, p.organization_id)))));

-- intervention_level_types
drop policy intervention_level_types_select on public.intervention_level_types;
create policy intervention_level_types_select on public.intervention_level_types
  for select using (
    (has_org_access(organization_id))
    or (is_admin_staff())
  );

drop policy intervention_level_types_admin_write on public.intervention_level_types;
create policy intervention_level_types_admin_write_i on public.intervention_level_types for insert with check (is_admin_staff());
create policy intervention_level_types_admin_write_u on public.intervention_level_types for update using (is_admin_staff()) with check (is_admin_staff());
create policy intervention_level_types_admin_write_d on public.intervention_level_types for delete using (is_admin_staff());

-- irns
drop policy irns_select on public.irns;
create policy irns_select on public.irns
  for select using (
    ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = irns.inspection_record_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = irns.inspection_record_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy irns_write on public.irns;
create policy irns_write_i on public.irns for insert with check ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = irns.inspection_record_id) AND has_project_access(p.id, p.organization_id)))));
create policy irns_write_u on public.irns for update using ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = irns.inspection_record_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = irns.inspection_record_id) AND has_project_access(p.id, p.organization_id)))));
create policy irns_write_d on public.irns for delete using ((EXISTS ( SELECT 1
   FROM (inspection_records r
     JOIN projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = irns.inspection_record_id) AND has_project_access(p.id, p.organization_id)))));

-- itp_items
drop policy itp_items_select on public.itp_items;
create policy itp_items_select on public.itp_items
  for select using (
    ((EXISTS ( SELECT 1
   FROM ((itp_sections s
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((s.id = itp_items.section_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM ((itp_sections s
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((s.id = itp_items.section_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status))))))
  );

drop policy itp_items_write on public.itp_items;
create policy itp_items_write_i on public.itp_items for insert with check ((EXISTS ( SELECT 1
   FROM ((itp_sections s
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((s.id = itp_items.section_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status))))));
create policy itp_items_write_u on public.itp_items for update using ((EXISTS ( SELECT 1
   FROM ((itp_sections s
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((s.id = itp_items.section_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status)))))) with check ((EXISTS ( SELECT 1
   FROM ((itp_sections s
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((s.id = itp_items.section_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status))))));
create policy itp_items_write_d on public.itp_items for delete using ((EXISTS ( SELECT 1
   FROM ((itp_sections s
     JOIN itps i ON ((i.id = s.itp_id)))
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((s.id = itp_items.section_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status))))));

-- itp_sections
drop policy itp_sections_select on public.itp_sections;
create policy itp_sections_select on public.itp_sections
  for select using (
    ((EXISTS ( SELECT 1
   FROM (itps i
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((i.id = itp_sections.itp_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM (itps i
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((i.id = itp_sections.itp_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status))))))
  );

drop policy itp_sections_write on public.itp_sections;
create policy itp_sections_write_i on public.itp_sections for insert with check ((EXISTS ( SELECT 1
   FROM (itps i
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((i.id = itp_sections.itp_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status))))));
create policy itp_sections_write_u on public.itp_sections for update using ((EXISTS ( SELECT 1
   FROM (itps i
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((i.id = itp_sections.itp_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status)))))) with check ((EXISTS ( SELECT 1
   FROM (itps i
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((i.id = itp_sections.itp_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status))))));
create policy itp_sections_write_d on public.itp_sections for delete using ((EXISTS ( SELECT 1
   FROM (itps i
     JOIN projects p ON ((p.id = i.project_id)))
  WHERE ((i.id = itp_sections.itp_id) AND ((is_jags_staff() AND has_org_access(p.organization_id)) OR is_client_itp_creator(p.id, i.status))))));

-- master_disciplines
drop policy master_disciplines_select on public.master_disciplines;
create policy master_disciplines_select on public.master_disciplines
  for select using (
    ((( SELECT auth.role() AS role) = 'authenticated'::text))
    or (is_jags_staff())
  );

drop policy master_disciplines_staff_write on public.master_disciplines;
create policy master_disciplines_staff_write_i on public.master_disciplines for insert with check (is_jags_staff());
create policy master_disciplines_staff_write_u on public.master_disciplines for update using (is_jags_staff()) with check (is_jags_staff());
create policy master_disciplines_staff_write_d on public.master_disciplines for delete using (is_jags_staff());

-- material_register
drop policy material_register_select on public.material_register;
create policy material_register_select on public.material_register
  for select using (
    ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = material_register.project_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = material_register.project_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy material_register_write on public.material_register;
create policy material_register_write_i on public.material_register for insert with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = material_register.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy material_register_write_u on public.material_register for update using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = material_register.project_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = material_register.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy material_register_write_d on public.material_register for delete using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = material_register.project_id) AND has_project_access(p.id, p.organization_id)))));

-- ncr_photos
drop policy ncr_photos_select on public.ncr_photos;
create policy ncr_photos_select on public.ncr_photos
  for select using (
    ((EXISTS ( SELECT 1
   FROM (ncrs n
     JOIN projects p ON ((p.id = n.project_id)))
  WHERE ((n.id = ncr_photos.ncr_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM (ncrs n
     JOIN projects p ON ((p.id = n.project_id)))
  WHERE ((n.id = ncr_photos.ncr_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy ncr_photos_write on public.ncr_photos;
create policy ncr_photos_write_i on public.ncr_photos for insert with check ((EXISTS ( SELECT 1
   FROM (ncrs n
     JOIN projects p ON ((p.id = n.project_id)))
  WHERE ((n.id = ncr_photos.ncr_id) AND has_project_access(p.id, p.organization_id)))));
create policy ncr_photos_write_u on public.ncr_photos for update using ((EXISTS ( SELECT 1
   FROM (ncrs n
     JOIN projects p ON ((p.id = n.project_id)))
  WHERE ((n.id = ncr_photos.ncr_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM (ncrs n
     JOIN projects p ON ((p.id = n.project_id)))
  WHERE ((n.id = ncr_photos.ncr_id) AND has_project_access(p.id, p.organization_id)))));
create policy ncr_photos_write_d on public.ncr_photos for delete using ((EXISTS ( SELECT 1
   FROM (ncrs n
     JOIN projects p ON ((p.id = n.project_id)))
  WHERE ((n.id = ncr_photos.ncr_id) AND has_project_access(p.id, p.organization_id)))));

-- ncrs
drop policy ncrs_select on public.ncrs;
create policy ncrs_select on public.ncrs
  for select using (
    ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = ncrs.project_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = ncrs.project_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy ncrs_write on public.ncrs;
create policy ncrs_write_i on public.ncrs for insert with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = ncrs.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy ncrs_write_u on public.ncrs for update using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = ncrs.project_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = ncrs.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy ncrs_write_d on public.ncrs for delete using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = ncrs.project_id) AND has_project_access(p.id, p.organization_id)))));

-- notice_period_configs
drop policy notice_period_configs_select on public.notice_period_configs;
create policy notice_period_configs_select on public.notice_period_configs
  for select using (
    ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = notice_period_configs.project_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = notice_period_configs.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))))
  );

drop policy notice_period_configs_write on public.notice_period_configs;
create policy notice_period_configs_write_i on public.notice_period_configs for insert with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = notice_period_configs.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))));
create policy notice_period_configs_write_u on public.notice_period_configs for update using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = notice_period_configs.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = notice_period_configs.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))));
create policy notice_period_configs_write_d on public.notice_period_configs for delete using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = notice_period_configs.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))));

-- organization_plans
drop policy organization_plans_select on public.organization_plans;
create policy organization_plans_select on public.organization_plans
  for select using (
    (has_org_access(organization_id))
    or (is_jags_staff())
  );

drop policy organization_plans_staff_write on public.organization_plans;
create policy organization_plans_staff_write_i on public.organization_plans for insert with check (is_jags_staff());
create policy organization_plans_staff_write_u on public.organization_plans for update using (is_jags_staff()) with check (is_jags_staff());
create policy organization_plans_staff_write_d on public.organization_plans for delete using (is_jags_staff());

-- personnel_certifications
drop policy personnel_certifications_select on public.personnel_certifications;
create policy personnel_certifications_select on public.personnel_certifications
  for select using (
    ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = personnel_certifications.project_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = personnel_certifications.project_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy personnel_certifications_write on public.personnel_certifications;
create policy personnel_certifications_write_i on public.personnel_certifications for insert with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = personnel_certifications.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy personnel_certifications_write_u on public.personnel_certifications for update using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = personnel_certifications.project_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = personnel_certifications.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy personnel_certifications_write_d on public.personnel_certifications for delete using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = personnel_certifications.project_id) AND has_project_access(p.id, p.organization_id)))));

-- punch_list_items
drop policy punch_list_items_select on public.punch_list_items;
create policy punch_list_items_select on public.punch_list_items
  for select using (
    ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = punch_list_items.project_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = punch_list_items.project_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy punch_list_items_write on public.punch_list_items;
create policy punch_list_items_write_i on public.punch_list_items for insert with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = punch_list_items.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy punch_list_items_write_u on public.punch_list_items for update using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = punch_list_items.project_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = punch_list_items.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy punch_list_items_write_d on public.punch_list_items for delete using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = punch_list_items.project_id) AND has_project_access(p.id, p.organization_id)))));

-- standalone_assignment_measurements
drop policy standalone_assignment_measurements_select on public.standalone_assignment_measurements;
create policy standalone_assignment_measurements_select on public.standalone_assignment_measurements
  for select using (
    ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_measurements.assignment_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_measurements.assignment_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy standalone_assignment_measurements_write on public.standalone_assignment_measurements;
create policy standalone_assignment_measurements_write_i on public.standalone_assignment_measurements for insert with check ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_measurements.assignment_id) AND has_project_access(p.id, p.organization_id)))));
create policy standalone_assignment_measurements_write_u on public.standalone_assignment_measurements for update using ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_measurements.assignment_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_measurements.assignment_id) AND has_project_access(p.id, p.organization_id)))));
create policy standalone_assignment_measurements_write_d on public.standalone_assignment_measurements for delete using ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_measurements.assignment_id) AND has_project_access(p.id, p.organization_id)))));

-- standalone_assignment_photos
drop policy standalone_assignment_photos_select on public.standalone_assignment_photos;
create policy standalone_assignment_photos_select on public.standalone_assignment_photos
  for select using (
    ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_photos.assignment_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_photos.assignment_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy standalone_assignment_photos_write on public.standalone_assignment_photos;
create policy standalone_assignment_photos_write_i on public.standalone_assignment_photos for insert with check ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_photos.assignment_id) AND has_project_access(p.id, p.organization_id)))));
create policy standalone_assignment_photos_write_u on public.standalone_assignment_photos for update using ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_photos.assignment_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_photos.assignment_id) AND has_project_access(p.id, p.organization_id)))));
create policy standalone_assignment_photos_write_d on public.standalone_assignment_photos for delete using ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_photos.assignment_id) AND has_project_access(p.id, p.organization_id)))));

-- standalone_assignment_punch_items
drop policy standalone_assignment_punch_items_select on public.standalone_assignment_punch_items;
create policy standalone_assignment_punch_items_select on public.standalone_assignment_punch_items
  for select using (
    ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_punch_items.assignment_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_punch_items.assignment_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy standalone_assignment_punch_items_write on public.standalone_assignment_punch_items;
create policy standalone_assignment_punch_items_write_i on public.standalone_assignment_punch_items for insert with check ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_punch_items.assignment_id) AND has_project_access(p.id, p.organization_id)))));
create policy standalone_assignment_punch_items_write_u on public.standalone_assignment_punch_items for update using ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_punch_items.assignment_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_punch_items.assignment_id) AND has_project_access(p.id, p.organization_id)))));
create policy standalone_assignment_punch_items_write_d on public.standalone_assignment_punch_items for delete using ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_punch_items.assignment_id) AND has_project_access(p.id, p.organization_id)))));

-- standalone_assignment_signatures
drop policy standalone_assignment_signatures_select on public.standalone_assignment_signatures;
create policy standalone_assignment_signatures_select on public.standalone_assignment_signatures
  for select using (
    ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_signatures.assignment_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_signatures.assignment_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy standalone_assignment_signatures_write on public.standalone_assignment_signatures;
create policy standalone_assignment_signatures_write_i on public.standalone_assignment_signatures for insert with check ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_signatures.assignment_id) AND has_project_access(p.id, p.organization_id)))));
create policy standalone_assignment_signatures_write_u on public.standalone_assignment_signatures for update using ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_signatures.assignment_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_signatures.assignment_id) AND has_project_access(p.id, p.organization_id)))));
create policy standalone_assignment_signatures_write_d on public.standalone_assignment_signatures for delete using ((EXISTS ( SELECT 1
   FROM (standalone_assignments a
     JOIN projects p ON ((p.id = a.project_id)))
  WHERE ((a.id = standalone_assignment_signatures.assignment_id) AND has_project_access(p.id, p.organization_id)))));

-- standalone_assignments
drop policy standalone_assignments_select on public.standalone_assignments;
create policy standalone_assignments_select on public.standalone_assignments
  for select using (
    ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = standalone_assignments.project_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = standalone_assignments.project_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy standalone_assignments_write on public.standalone_assignments;
create policy standalone_assignments_write_i on public.standalone_assignments for insert with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = standalone_assignments.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy standalone_assignments_write_u on public.standalone_assignments for update using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = standalone_assignments.project_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = standalone_assignments.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy standalone_assignments_write_d on public.standalone_assignments for delete using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = standalone_assignments.project_id) AND has_project_access(p.id, p.organization_id)))));

-- team_members
drop policy team_members_select on public.team_members;
create policy team_members_select on public.team_members
  for select using (
    (is_jags_staff())
    or ((is_admin_staff() OR is_team_lead_of(team_id)))
  );

drop policy team_members_write on public.team_members;
create policy team_members_write_i on public.team_members for insert with check ((is_admin_staff() OR is_team_lead_of(team_id)));
create policy team_members_write_u on public.team_members for update using ((is_admin_staff() OR is_team_lead_of(team_id))) with check ((is_admin_staff() OR is_team_lead_of(team_id)));
create policy team_members_write_d on public.team_members for delete using ((is_admin_staff() OR is_team_lead_of(team_id)));

-- team_project_assignments
drop policy team_project_assignments_select on public.team_project_assignments;
create policy team_project_assignments_select on public.team_project_assignments
  for select using (
    (is_jags_staff())
    or ((is_admin_staff() OR is_team_lead_of(team_id)))
  );

drop policy team_project_assignments_write on public.team_project_assignments;
create policy team_project_assignments_write_i on public.team_project_assignments for insert with check ((is_admin_staff() OR is_team_lead_of(team_id)));
create policy team_project_assignments_write_u on public.team_project_assignments for update using ((is_admin_staff() OR is_team_lead_of(team_id))) with check ((is_admin_staff() OR is_team_lead_of(team_id)));
create policy team_project_assignments_write_d on public.team_project_assignments for delete using ((is_admin_staff() OR is_team_lead_of(team_id)));

-- teams
drop policy teams_select on public.teams;
create policy teams_select on public.teams
  for select using (
    (is_jags_staff())
    or (is_admin_staff())
  );

drop policy teams_admin_write on public.teams;
create policy teams_admin_write_i on public.teams for insert with check (is_admin_staff());
create policy teams_admin_write_u on public.teams for update using (is_admin_staff()) with check (is_admin_staff());
create policy teams_admin_write_d on public.teams for delete using (is_admin_staff());

-- vault_folders
drop policy vault_folders_select on public.vault_folders;
create policy vault_folders_select on public.vault_folders
  for select using (
    ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = vault_folders.project_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = vault_folders.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))))
  );

drop policy vault_folders_write on public.vault_folders;
create policy vault_folders_write_i on public.vault_folders for insert with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = vault_folders.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))));
create policy vault_folders_write_u on public.vault_folders for update using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = vault_folders.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = vault_folders.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))));
create policy vault_folders_write_d on public.vault_folders for delete using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = vault_folders.project_id) AND is_jags_staff() AND has_project_access(p.id, p.organization_id)))));

-- welder_qualification_register
drop policy welder_qualification_register_select on public.welder_qualification_register;
create policy welder_qualification_register_select on public.welder_qualification_register
  for select using (
    ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = welder_qualification_register.project_id) AND has_project_access(p.id, p.organization_id)))))
    or ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = welder_qualification_register.project_id) AND has_project_access(p.id, p.organization_id)))))
  );

drop policy welder_qualification_register_write on public.welder_qualification_register;
create policy welder_qualification_register_write_i on public.welder_qualification_register for insert with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = welder_qualification_register.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy welder_qualification_register_write_u on public.welder_qualification_register for update using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = welder_qualification_register.project_id) AND has_project_access(p.id, p.organization_id))))) with check ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = welder_qualification_register.project_id) AND has_project_access(p.id, p.organization_id)))));
create policy welder_qualification_register_write_d on public.welder_qualification_register for delete using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = welder_qualification_register.project_id) AND has_project_access(p.id, p.organization_id)))));
