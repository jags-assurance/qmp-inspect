-- The org-branding storage policies compared the org id with foldername(o.name), where o is
-- organizations, i.e. the organisation NAME, so the folder check could never match the object path.
-- Qualify with storage.objects.name so the first path segment is the organisation id.
drop policy if exists org_branding_select on storage.objects;
create policy org_branding_select on storage.objects for select
  using (
    bucket_id = 'org-branding'
    and exists (
      select 1 from public.organizations o
      where o.id::text = (storage.foldername(objects.name))[1]
        and public.has_org_access(o.id)
    )
  );

drop policy if exists org_branding_insert on storage.objects;
create policy org_branding_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'org-branding'
    and exists (
      select 1 from public.organizations o
      where o.id::text = (storage.foldername(objects.name))[1]
        and (public.is_jags_staff() or (o.engagement_scope = 'self_managed' and public.has_org_access(o.id)))
    )
  );

drop policy if exists org_branding_update on storage.objects;
create policy org_branding_update on storage.objects for update to authenticated
  using (
    bucket_id = 'org-branding'
    and exists (
      select 1 from public.organizations o
      where o.id::text = (storage.foldername(objects.name))[1]
        and (public.is_jags_staff() or (o.engagement_scope = 'self_managed' and public.has_org_access(o.id)))
    )
  );
