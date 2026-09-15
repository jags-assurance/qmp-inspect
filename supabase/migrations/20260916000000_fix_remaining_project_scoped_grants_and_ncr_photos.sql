-- Follow-up to 20260914000000_fix_project_scoped_access_grants.sql: that earlier fix covered the
-- 18 tables an audit happened to check. This closes the same has_org_access() gap on the remaining
-- project-scoped tables the audit's scope missed, found while adding ncr_photos and noticing
-- standalone_assignment_photos still had the old pattern.

-- projects itself: the actual root of the leak. A project-scoped grant currently sees every
-- project in the org via this table, defeating the point of scope_type='project'.
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select using (
  has_project_access(id, organization_id)
);
drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects for all using (
  is_jags_staff() and has_project_access(id, organization_id)
) with check (
  is_jags_staff() and has_project_access(id, organization_id)
);

-- inspection_photos
drop policy if exists inspection_photos_select on public.inspection_photos;
create policy inspection_photos_select on public.inspection_photos for select using (
  exists (select 1 from public.inspection_records r join public.projects p on p.id = r.project_id where r.id = inspection_photos.inspection_record_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists inspection_photos_write on public.inspection_photos;
create policy inspection_photos_write on public.inspection_photos for all using (
  exists (select 1 from public.inspection_records r join public.projects p on p.id = r.project_id where r.id = inspection_photos.inspection_record_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.inspection_records r join public.projects p on p.id = r.project_id where r.id = inspection_photos.inspection_record_id and has_project_access(p.id, p.organization_id))
);

-- standalone_assignment_measurements
drop policy if exists standalone_assignment_measurements_select on public.standalone_assignment_measurements;
create policy standalone_assignment_measurements_select on public.standalone_assignment_measurements for select using (
  exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id where a.id = standalone_assignment_measurements.assignment_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists standalone_assignment_measurements_write on public.standalone_assignment_measurements;
create policy standalone_assignment_measurements_write on public.standalone_assignment_measurements for all using (
  exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id where a.id = standalone_assignment_measurements.assignment_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id where a.id = standalone_assignment_measurements.assignment_id and has_project_access(p.id, p.organization_id))
);

-- standalone_assignment_photos
drop policy if exists standalone_assignment_photos_select on public.standalone_assignment_photos;
create policy standalone_assignment_photos_select on public.standalone_assignment_photos for select using (
  exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id where a.id = standalone_assignment_photos.assignment_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists standalone_assignment_photos_write on public.standalone_assignment_photos;
create policy standalone_assignment_photos_write on public.standalone_assignment_photos for all using (
  exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id where a.id = standalone_assignment_photos.assignment_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id where a.id = standalone_assignment_photos.assignment_id and has_project_access(p.id, p.organization_id))
);

-- standalone_assignment_punch_items
drop policy if exists standalone_assignment_punch_items_select on public.standalone_assignment_punch_items;
create policy standalone_assignment_punch_items_select on public.standalone_assignment_punch_items for select using (
  exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id where a.id = standalone_assignment_punch_items.assignment_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists standalone_assignment_punch_items_write on public.standalone_assignment_punch_items;
create policy standalone_assignment_punch_items_write on public.standalone_assignment_punch_items for all using (
  exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id where a.id = standalone_assignment_punch_items.assignment_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id where a.id = standalone_assignment_punch_items.assignment_id and has_project_access(p.id, p.organization_id))
);

-- standalone_assignment_signatures
drop policy if exists standalone_assignment_signatures_select on public.standalone_assignment_signatures;
create policy standalone_assignment_signatures_select on public.standalone_assignment_signatures for select using (
  exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id where a.id = standalone_assignment_signatures.assignment_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists standalone_assignment_signatures_write on public.standalone_assignment_signatures;
create policy standalone_assignment_signatures_write on public.standalone_assignment_signatures for all using (
  exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id where a.id = standalone_assignment_signatures.assignment_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id where a.id = standalone_assignment_signatures.assignment_id and has_project_access(p.id, p.organization_id))
);

-- notice_period_configs
drop policy if exists notice_period_configs_select on public.notice_period_configs;
create policy notice_period_configs_select on public.notice_period_configs for select using (
  exists (select 1 from public.projects p where p.id = notice_period_configs.project_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists notice_period_configs_write on public.notice_period_configs;
create policy notice_period_configs_write on public.notice_period_configs for all using (
  exists (select 1 from public.projects p where p.id = notice_period_configs.project_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = notice_period_configs.project_id and is_jags_staff() and has_project_access(p.id, p.organization_id))
);

-- calibration_register / welder_qualification_register / material_register
drop policy if exists calibration_register_select on public.calibration_register;
create policy calibration_register_select on public.calibration_register for select using (
  exists (select 1 from public.projects p where p.id = calibration_register.project_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists calibration_register_write on public.calibration_register;
create policy calibration_register_write on public.calibration_register for all using (
  exists (select 1 from public.projects p where p.id = calibration_register.project_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = calibration_register.project_id and has_project_access(p.id, p.organization_id))
);

drop policy if exists welder_qualification_register_select on public.welder_qualification_register;
create policy welder_qualification_register_select on public.welder_qualification_register for select using (
  exists (select 1 from public.projects p where p.id = welder_qualification_register.project_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists welder_qualification_register_write on public.welder_qualification_register;
create policy welder_qualification_register_write on public.welder_qualification_register for all using (
  exists (select 1 from public.projects p where p.id = welder_qualification_register.project_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = welder_qualification_register.project_id and has_project_access(p.id, p.organization_id))
);

drop policy if exists material_register_select on public.material_register;
create policy material_register_select on public.material_register for select using (
  exists (select 1 from public.projects p where p.id = material_register.project_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists material_register_write on public.material_register;
create policy material_register_write on public.material_register for all using (
  exists (select 1 from public.projects p where p.id = material_register.project_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = material_register.project_id and has_project_access(p.id, p.organization_id))
);

-- activity_expected_records (select only -- write already uses a different, correct check)
drop policy if exists activity_expected_records_select on public.activity_expected_records;
create policy activity_expected_records_select on public.activity_expected_records for select using (
  exists (select 1 from public.itp_items it join public.itp_sections s on s.id = it.section_id join public.itps i on i.id = s.itp_id join public.projects p on p.id = i.project_id where it.id = activity_expected_records.itp_item_id and has_project_access(p.id, p.organization_id))
);

-- background_jobs / notifications insert-time scoping (the same gap, on write-only policies this
-- time -- lets a project-scoped user queue a render job or a notification tagged to a sibling
-- project in the same org, rather than exposing existing data).
drop policy if exists background_jobs_insert on public.background_jobs;
create policy background_jobs_insert on public.background_jobs for insert with check (
  ((job_type = 'render_itp_pdf') and exists (
    select 1 from public.itps i join public.projects p on p.id = i.project_id
    where i.id = ((background_jobs.payload ->> 'itp_id')::uuid) and has_project_access(p.id, p.organization_id)
  ))
  or ((job_type = 'generate_monthly_report_pack') and is_jags_staff() and (payload ->> 'organization_id') is not null and has_org_access(((payload ->> 'organization_id')::uuid)))
  or ((job_type = 'render_inspection_report_pdf') and exists (
    select 1 from public.inspection_records r join public.projects p on p.id = r.project_id
    where r.id = ((background_jobs.payload ->> 'inspection_record_id')::uuid) and has_project_access(p.id, p.organization_id)
  ))
  or ((job_type = 'render_fat_report_pdf') and exists (
    select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id
    where a.id = ((background_jobs.payload ->> 'assignment_id')::uuid) and has_project_access(p.id, p.organization_id)
  ))
);

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated with check (
  project_id is null
    and has_org_access(organization_id)
  or project_id is not null
    and has_project_access(project_id, organization_id)
);

-- --------------------------------------------------------------------------------------------
-- New: ncr_photos (evidence attached to an NCR, e.g. a photo of the non-conformance) -- built with
-- the correct has_project_access() policy from the outset, matching the fix above rather than the
-- pre-fix pattern the older *_photos tables shipped with.
-- --------------------------------------------------------------------------------------------
create table if not exists public.ncr_photos (
  id uuid primary key default gen_random_uuid(),
  ncr_id uuid not null references public.ncrs (id) on delete cascade,
  storage_path text not null,
  caption text,
  uploaded_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index if not exists ncr_photos_ncr_idx on public.ncr_photos (ncr_id);

alter table public.ncr_photos enable row level security;

drop policy if exists ncr_photos_select on public.ncr_photos;
create policy ncr_photos_select on public.ncr_photos for select using (
  exists (select 1 from public.ncrs n join public.projects p on p.id = n.project_id where n.id = ncr_photos.ncr_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists ncr_photos_write on public.ncr_photos;
create policy ncr_photos_write on public.ncr_photos for all using (
  exists (select 1 from public.ncrs n join public.projects p on p.id = n.project_id where n.id = ncr_photos.ncr_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.ncrs n join public.projects p on p.id = n.project_id where n.id = ncr_photos.ncr_id and has_project_access(p.id, p.organization_id))
);
