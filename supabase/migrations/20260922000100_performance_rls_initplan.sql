-- Live performance audit finding: 10 RLS policies call auth.uid()/auth.role() directly rather than
-- `(select auth.uid())` — Postgres re-evaluates the bare form once PER ROW scanned; the wrapped form
-- lets the planner treat it as a stable InitPlan evaluated once per query. No behavior change, same
-- logic every time — see https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select.
-- Each policy below is dropped and recreated with an identical qual/with_check, only the auth.*()
-- calls rewritten.

drop policy users_select_self_or_staff on public.users;
create policy users_select_self_or_staff on public.users
  for select using (id = (select auth.uid()) or is_jags_staff());

drop policy users_update_self on public.users;
create policy users_update_self on public.users
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy access_grants_select_self_or_staff on public.access_grants;
create policy access_grants_select_self_or_staff on public.access_grants
  for select using (user_id = (select auth.uid()) or is_jags_staff());

drop policy master_disciplines_select on public.master_disciplines;
create policy master_disciplines_select on public.master_disciplines
  for select using ((select auth.role()) = 'authenticated');

drop policy custom_role_assignments_select on public.custom_role_assignments;
create policy custom_role_assignments_select on public.custom_role_assignments
  for select using (user_id = (select auth.uid()) or is_jags_staff());

drop policy notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (recipient_user_id = (select auth.uid()));

drop policy notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update using (recipient_user_id = (select auth.uid())) with check (recipient_user_id = (select auth.uid()));

drop policy project_parties_write on public.project_parties;
create policy project_parties_write on public.project_parties
  for all using (
    exists (select 1 from public.projects p where p.id = project_parties.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or has_custom_permission((select auth.uid()), 'add_project_party', project_id)
    or has_custom_permission((select auth.uid()), 'reassign_project_party', project_id)
  )
  with check (
    exists (select 1 from public.projects p where p.id = project_parties.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or has_custom_permission((select auth.uid()), 'add_project_party', project_id)
    or has_custom_permission((select auth.uid()), 'reassign_project_party', project_id)
  );

drop policy activity_expected_records_write on public.activity_expected_records;
create policy activity_expected_records_write on public.activity_expected_records
  for all using (
    is_jags_staff()
    or exists (
      select 1
      from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join project_parties pp on pp.project_id = i.project_id
      where it.id = activity_expected_records.itp_item_id
        and pp.user_id = (select auth.uid())
        and (
          (activity_expected_records.provider = 'jags' and pp.party_type = 'jags')
          or (activity_expected_records.provider = 'tpi' and pp.party_type = 'tpi_lab')
          or (activity_expected_records.provider = 'contractor' and pp.party_type = any (array['main_contractor', 'subcontractor']))
        )
    )
  )
  with check (
    is_jags_staff()
    or exists (
      select 1
      from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join project_parties pp on pp.project_id = i.project_id
      where it.id = activity_expected_records.itp_item_id
        and pp.user_id = (select auth.uid())
        and (
          (activity_expected_records.provider = 'jags' and pp.party_type = 'jags')
          or (activity_expected_records.provider = 'tpi' and pp.party_type = 'tpi_lab')
          or (activity_expected_records.provider = 'contractor' and pp.party_type = any (array['main_contractor', 'subcontractor']))
        )
    )
  );

drop policy background_jobs_select on public.background_jobs;
create policy background_jobs_select on public.background_jobs
  for select using (
    ((payload ->> 'requested_by')::uuid = (select auth.uid()))
    or (job_type = 'render_itp_pdf' and exists (
      select 1 from itps i join projects p on p.id = i.project_id
      where i.id = ((background_jobs.payload ->> 'itp_id'))::uuid and has_project_access(p.id, p.organization_id)
    ))
    or (job_type = 'generate_monthly_report_pack' and is_jags_staff() and (payload ->> 'organization_id') is not null
        and has_org_access(((payload ->> 'organization_id'))::uuid))
    or (job_type = 'generate_weekly_report_pack' and is_jags_staff() and (payload ->> 'organization_id') is not null
        and has_org_access(((payload ->> 'organization_id'))::uuid))
    or (job_type = 'render_inspection_report_pdf' and exists (
      select 1 from inspection_records r join projects p on p.id = r.project_id
      where r.id = ((background_jobs.payload ->> 'inspection_record_id'))::uuid and has_project_access(p.id, p.organization_id)
    ))
    or (job_type = 'render_fat_report_pdf' and exists (
      select 1 from standalone_assignments a join projects p on p.id = a.project_id
      where a.id = ((background_jobs.payload ->> 'assignment_id'))::uuid and has_project_access(p.id, p.organization_id)
    ))
    or (job_type = 'render_portfolio_summary_pdf' and is_jags_staff())
    or (job_type = 'render_ncr_pdf' and exists (
      select 1 from ncrs n join projects p on p.id = n.project_id
      where n.id = ((background_jobs.payload ->> 'ncr_id'))::uuid and has_project_access(p.id, p.organization_id)
    ))
  );
