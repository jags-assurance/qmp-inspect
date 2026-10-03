-- The first edit of an issued ITP appends its reason to the revision-0 "Initial issue" row (that row
-- already exists and itp_revisions is UNIQUE (itp_id, revision), so inserting a second one for the
-- same revision failed and blocked every first post-issue edit). Appending needs UPDATE; with no
-- UPDATE policy the write silently affected zero rows and the reason was lost. Same predicate as the
-- existing staff insert policy; snapshots themselves are never rewritten by the app.
create policy itp_revisions_staff_update on public.itp_revisions
  for update
  using (exists (
    select 1 from public.itps i join public.projects p on p.id = i.project_id
    where i.id = itp_revisions.itp_id and public.is_jags_staff() and public.has_org_access(p.organization_id)))
  with check (exists (
    select 1 from public.itps i join public.projects p on p.id = i.project_id
    where i.id = itp_revisions.itp_id and public.is_jags_staff() and public.has_org_access(p.organization_id)));
