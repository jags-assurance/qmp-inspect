-- Named "Responsible Person" per project: a single point of accountability for the project overall,
-- distinct from the per-activity H/W/R/S party assignments (project_parties / activity sign-off
-- chain) and distinct from access_grants (who can reach the project at all). Nullable because
-- existing projects don't have one set yet — this is a new concept layered on top, not a required
-- field retrofitted onto every historical row.
--
-- No RLS changes needed: projects already has projects_select (has_org_access) and
-- projects_staff_write (is_jags_staff) policies covering all columns, and this column is exactly the
-- kind of project-settings field those already gate (same boundary as allow_client_execution).
alter table public.projects
  add column responsible_person_id uuid references public.users (id);
