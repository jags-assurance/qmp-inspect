-- Enables a JAGS Inspector to be restricted to specific organisations/projects, instead of every
-- inspector automatically seeing every client (the current default, via a 'global' access_grants
-- row — unchanged for existing accounts). Until now every "_staff_write" policy below was gated on
-- is_jags_staff() alone, with no organisation check at all, so scoping an inspector's access_grants
-- to one organisation would have restricted their SELECTs but left every write wide open at the
-- database layer regardless of grant scope. Each policy here is changed from
--   using (is_jags_staff())
-- to
--   using (is_jags_staff() and has_org_access(<that row's organisation>))
-- which is NOT the same as swapping in has_org_access() alone: that would let any client/contractor
-- with org access start writing to staff-only tables like handover_certificates. AND-ing the two
-- keeps "staff only" as the identity check and adds "and only orgs this staff member is actually
-- granted" as a second, independent check. has_org_access() already treats a 'global' grant as
-- matching every organisation, so the existing admin account (and any inspector left with a
-- 'global' grant, the default) sees no behavior change whatsoever — this migration only takes
-- effect once an inspector is deliberately given an 'organization' or 'project' scoped grant
-- instead.

drop policy projects_staff_write on public.projects;
create policy projects_write on public.projects
  for all
  using (public.is_jags_staff() and public.has_org_access(organization_id))
  with check (public.is_jags_staff() and public.has_org_access(organization_id));

drop policy project_parties_staff_write on public.project_parties;
create policy project_parties_write on public.project_parties
  for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_parties.project_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_parties.project_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  );

drop policy itps_staff_write on public.itps;
create policy itps_write on public.itps
  for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = itps.project_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = itps.project_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  );

drop policy itp_sections_staff_write on public.itp_sections;
create policy itp_sections_write on public.itp_sections
  for all
  using (
    exists (
      select 1 from public.itps i
      join public.projects p on p.id = i.project_id
      where i.id = itp_sections.itp_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.itps i
      join public.projects p on p.id = i.project_id
      where i.id = itp_sections.itp_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  );

drop policy itp_items_staff_write on public.itp_items;
create policy itp_items_write on public.itp_items
  for all
  using (
    exists (
      select 1 from public.itp_sections s
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where s.id = itp_items.section_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.itp_sections s
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where s.id = itp_items.section_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  );

drop policy activity_party_intervention_staff_write on public.activity_party_intervention;
create policy activity_party_intervention_write on public.activity_party_intervention
  for all
  using (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = activity_party_intervention.itp_item_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = activity_party_intervention.itp_item_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  );

drop policy checklist_templates_staff_write on public.checklist_templates;
create policy checklist_templates_write on public.checklist_templates
  for all
  using (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = checklist_templates.itp_item_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = checklist_templates.itp_item_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  );

drop policy checklist_items_staff_write on public.checklist_items;
create policy checklist_items_write on public.checklist_items
  for all
  using (
    exists (
      select 1 from public.checklist_templates t
      join public.itp_items it on it.id = t.itp_item_id
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where t.id = checklist_items.template_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.checklist_templates t
      join public.itp_items it on it.id = t.itp_item_id
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where t.id = checklist_items.template_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  );

drop policy notice_period_configs_staff_write on public.notice_period_configs;
create policy notice_period_configs_write on public.notice_period_configs
  for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = notice_period_configs.project_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = notice_period_configs.project_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  );

drop policy vault_folders_staff_write on public.vault_folders;
create policy vault_folders_write on public.vault_folders
  for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = vault_folders.project_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = vault_folders.project_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  );

drop policy data_books_staff_write on public.data_books;
create policy data_books_write on public.data_books
  for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = data_books.project_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = data_books.project_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  );

drop policy handover_certificates_staff_write on public.handover_certificates;
create policy handover_certificates_write on public.handover_certificates
  for all
  using (
    exists (
      select 1 from public.data_books db
      join public.projects p on p.id = db.project_id
      where db.id = handover_certificates.data_book_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.data_books db
      join public.projects p on p.id = db.project_id
      where db.id = handover_certificates.data_book_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  );

-- Deliberately left untouched (genuinely JAGS-internal/administrative, not per-tenant operational
-- data an inspector's org/project grant should ever widen or narrow):
--   organizations_staff_write, users_staff_write, access_grants_staff_write — account/tenant
--     administration, already Admin-only at the app layer (isAdminStaff).
--   master_disciplines_staff_write — global reference taxonomy, not tenant data.
--   itp_master_*_staff_write (4 policies) — the Tier-1 internal library is deliberately isolated
--     from has_org_access() entirely, per its own migration's comments (Tier 1 must never leak to
--     any client's org-scoped view, so it can't be gated on org access at all).
--   numbering_configs_staff_write, ai_usage_log staff write — Admin-only in practice already.
