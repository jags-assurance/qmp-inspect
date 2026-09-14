-- Fix: has_org_access() never checked access_grants.project_id, so scope_type='project' grants
-- were functionally organization-wide. Found via audit of a real multi-party oil & gas scenario
-- (4 of 5 project-scoped parties on one project, in an org that could easily grow a second
-- project). This function restores the intended per-project restriction; has_org_access() itself
-- is left unchanged (still correct for genuinely org-wide checks not backed by a specific project
-- row, e.g. creating a brand-new project under an org).
create or replace function public.has_project_access(target_project_id uuid, target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.access_grants
    where user_id = auth.uid()
      and (
        scope_type = 'global'
        or (scope_type = 'organization' and organization_id = target_org_id)
        or (scope_type = 'project' and project_id = target_project_id)
      )
  );
$$;

-- itps
drop policy if exists itps_select on public.itps;
create policy itps_select on public.itps for select using (
  exists (select 1 from public.projects p where p.id = itps.project_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists itps_write on public.itps;
create policy itps_write on public.itps for all using (
  exists (select 1 from public.projects p where p.id = itps.project_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = itps.project_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
);

-- itp_sections
drop policy if exists itp_sections_select on public.itp_sections;
create policy itp_sections_select on public.itp_sections for select using (
  exists (select 1 from public.itps i join public.projects p on p.id = i.project_id where i.id = itp_sections.itp_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists itp_sections_write on public.itp_sections;
create policy itp_sections_write on public.itp_sections for all using (
  exists (select 1 from public.itps i join public.projects p on p.id = i.project_id where i.id = itp_sections.itp_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.itps i join public.projects p on p.id = i.project_id where i.id = itp_sections.itp_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
);

-- itp_items
drop policy if exists itp_items_select on public.itp_items;
create policy itp_items_select on public.itp_items for select using (
  exists (select 1 from public.itp_sections s join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where s.id = itp_items.section_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists itp_items_write on public.itp_items;
create policy itp_items_write on public.itp_items for all using (
  exists (select 1 from public.itp_sections s join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where s.id = itp_items.section_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.itp_sections s join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where s.id = itp_items.section_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
);

-- activity_party_intervention
drop policy if exists activity_party_intervention_select on public.activity_party_intervention;
create policy activity_party_intervention_select on public.activity_party_intervention for select using (
  exists (select 1 from public.itp_items it join public.itp_sections s on s.id = it.section_id join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where it.id = activity_party_intervention.itp_item_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists activity_party_intervention_write on public.activity_party_intervention;
create policy activity_party_intervention_write on public.activity_party_intervention for all using (
  exists (select 1 from public.itp_items it join public.itp_sections s on s.id = it.section_id join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where it.id = activity_party_intervention.itp_item_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.itp_items it join public.itp_sections s on s.id = it.section_id join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where it.id = activity_party_intervention.itp_item_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
);

-- activity_signoff_progress
drop policy if exists activity_signoff_progress_select on public.activity_signoff_progress;
create policy activity_signoff_progress_select on public.activity_signoff_progress for select using (
  exists (select 1 from public.itp_items it join public.itp_sections s on s.id = it.section_id join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where it.id = activity_signoff_progress.itp_item_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists activity_signoff_progress_write on public.activity_signoff_progress;
create policy activity_signoff_progress_write on public.activity_signoff_progress for all using (
  exists (select 1 from public.itp_items it join public.itp_sections s on s.id = it.section_id join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where it.id = activity_signoff_progress.itp_item_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.itp_items it join public.itp_sections s on s.id = it.section_id join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where it.id = activity_signoff_progress.itp_item_id and has_project_access(p.id, p.organization_id))
);

-- checklist_templates
drop policy if exists checklist_templates_select on public.checklist_templates;
create policy checklist_templates_select on public.checklist_templates for select using (
  exists (select 1 from public.itp_items it join public.itp_sections s on s.id = it.section_id join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where it.id = checklist_templates.itp_item_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists checklist_templates_write on public.checklist_templates;
create policy checklist_templates_write on public.checklist_templates for all using (
  exists (select 1 from public.itp_items it join public.itp_sections s on s.id = it.section_id join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where it.id = checklist_templates.itp_item_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.itp_items it join public.itp_sections s on s.id = it.section_id join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where it.id = checklist_templates.itp_item_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
);

-- checklist_items
drop policy if exists checklist_items_select on public.checklist_items;
create policy checklist_items_select on public.checklist_items for select using (
  exists (select 1 from public.checklist_templates t join public.itp_items it on it.id = t.itp_item_id join public.itp_sections s on s.id = it.section_id join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where t.id = checklist_items.template_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists checklist_items_write on public.checklist_items;
create policy checklist_items_write on public.checklist_items for all using (
  exists (select 1 from public.checklist_templates t join public.itp_items it on it.id = t.itp_item_id join public.itp_sections s on s.id = it.section_id join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where t.id = checklist_items.template_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.checklist_templates t join public.itp_items it on it.id = t.itp_item_id join public.itp_sections s on s.id = it.section_id join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where t.id = checklist_items.template_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
);

-- checklist_responses
drop policy if exists checklist_responses_select on public.checklist_responses;
create policy checklist_responses_select on public.checklist_responses for select using (
  exists (select 1 from public.inspection_records r join public.projects p on p.id = r.project_id where r.id = checklist_responses.inspection_record_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists checklist_responses_write on public.checklist_responses;
create policy checklist_responses_write on public.checklist_responses for all using (
  exists (select 1 from public.inspection_records r join public.projects p on p.id = r.project_id where r.id = checklist_responses.inspection_record_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.inspection_records r join public.projects p on p.id = r.project_id where r.id = checklist_responses.inspection_record_id and has_project_access(p.id, p.organization_id))
);

-- inspection_records
drop policy if exists inspection_records_select on public.inspection_records;
create policy inspection_records_select on public.inspection_records for select using (
  exists (select 1 from public.projects p where p.id = inspection_records.project_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists inspection_records_write on public.inspection_records;
create policy inspection_records_write on public.inspection_records for all using (
  exists (select 1 from public.projects p where p.id = inspection_records.project_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = inspection_records.project_id and has_project_access(p.id, p.organization_id))
);

-- irns
drop policy if exists irns_select on public.irns;
create policy irns_select on public.irns for select using (
  exists (select 1 from public.inspection_records r join public.projects p on p.id = r.project_id where r.id = irns.inspection_record_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists irns_write on public.irns;
create policy irns_write on public.irns for all using (
  exists (select 1 from public.inspection_records r join public.projects p on p.id = r.project_id where r.id = irns.inspection_record_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.inspection_records r join public.projects p on p.id = r.project_id where r.id = irns.inspection_record_id and has_project_access(p.id, p.organization_id))
);

-- ncrs
drop policy if exists ncrs_select on public.ncrs;
create policy ncrs_select on public.ncrs for select using (
  exists (select 1 from public.projects p where p.id = ncrs.project_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists ncrs_write on public.ncrs;
create policy ncrs_write on public.ncrs for all using (
  exists (select 1 from public.projects p where p.id = ncrs.project_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = ncrs.project_id and has_project_access(p.id, p.organization_id))
);

-- punch_list_items
drop policy if exists punch_list_items_select on public.punch_list_items;
create policy punch_list_items_select on public.punch_list_items for select using (
  exists (select 1 from public.projects p where p.id = punch_list_items.project_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists punch_list_items_write on public.punch_list_items;
create policy punch_list_items_write on public.punch_list_items for all using (
  exists (select 1 from public.projects p where p.id = punch_list_items.project_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = punch_list_items.project_id and has_project_access(p.id, p.organization_id))
);

-- standalone_assignments
drop policy if exists standalone_assignments_select on public.standalone_assignments;
create policy standalone_assignments_select on public.standalone_assignments for select using (
  exists (select 1 from public.projects p where p.id = standalone_assignments.project_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists standalone_assignments_write on public.standalone_assignments;
create policy standalone_assignments_write on public.standalone_assignments for all using (
  exists (select 1 from public.projects p where p.id = standalone_assignments.project_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = standalone_assignments.project_id and has_project_access(p.id, p.organization_id))
);

-- project_parties
drop policy if exists project_parties_select on public.project_parties;
create policy project_parties_select on public.project_parties for select using (
  exists (select 1 from public.projects p where p.id = project_parties.project_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists project_parties_write on public.project_parties;
create policy project_parties_write on public.project_parties for all using (
  exists (select 1 from public.projects p where p.id = project_parties.project_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = project_parties.project_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
);

-- data_books
drop policy if exists data_books_select on public.data_books;
create policy data_books_select on public.data_books for select using (
  exists (select 1 from public.projects p where p.id = data_books.project_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists data_books_write on public.data_books;
create policy data_books_write on public.data_books for all using (
  exists (select 1 from public.projects p where p.id = data_books.project_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = data_books.project_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
);

-- handover_certificates
drop policy if exists handover_certificates_select on public.handover_certificates;
create policy handover_certificates_select on public.handover_certificates for select using (
  exists (select 1 from public.data_books db join public.projects p on p.id = db.project_id where db.id = handover_certificates.data_book_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists handover_certificates_write on public.handover_certificates;
create policy handover_certificates_write on public.handover_certificates for all using (
  exists (select 1 from public.data_books db join public.projects p on p.id = db.project_id where db.id = handover_certificates.data_book_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.data_books db join public.projects p on p.id = db.project_id where db.id = handover_certificates.data_book_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
);

-- vault_folders
drop policy if exists vault_folders_select on public.vault_folders;
create policy vault_folders_select on public.vault_folders for select using (
  exists (select 1 from public.projects p where p.id = vault_folders.project_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists vault_folders_write on public.vault_folders;
create policy vault_folders_write on public.vault_folders for all using (
  exists (select 1 from public.projects p where p.id = vault_folders.project_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = vault_folders.project_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
);

-- vault_documents
drop policy if exists vault_documents_select on public.vault_documents;
create policy vault_documents_select on public.vault_documents for select using (
  exists (select 1 from public.vault_folders f join public.projects p on p.id = f.project_id where f.id = vault_documents.folder_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists vault_documents_insert on public.vault_documents;
create policy vault_documents_insert on public.vault_documents for insert with check (
  exists (select 1 from public.vault_folders f join public.projects p on p.id = f.project_id where f.id = vault_documents.folder_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists vault_documents_update on public.vault_documents;
create policy vault_documents_update on public.vault_documents for update using (
  exists (select 1 from public.vault_folders f join public.projects p on p.id = f.project_id where f.id = vault_documents.folder_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.vault_folders f join public.projects p on p.id = f.project_id where f.id = vault_documents.folder_id and has_project_access(p.id, p.organization_id))
);
