-- Reqs R113-R118: connects engagement_mode to REAL branding, not just brand_primary_color/
-- brand_accent_color. organizations.branding_logo_path (20260909210000_phase0_tenancy_schema.sql)
-- has existed since day one but was never backed by a Storage bucket, so nothing could ever upload
-- to it or read it back. This migration creates that bucket and its access policies.
--
-- Private (never public), same posture as "inspection-evidence"/"generated-documents"
-- (20260909280000_phase1_storage_policies.sql) — a client's logo is read back only via a signed URL,
-- never a public bucket URL. Path shape: {organization_id}/{filename}, so has_org_access() can be
-- applied the same way inspection_evidence's per-project-folder policies do.
insert into storage.buckets (id, name, public)
values ('org-branding', 'org-branding', false)
on conflict (id) do nothing;

create policy org_branding_select on storage.objects
  for select using (
    bucket_id = 'org-branding'
    and exists (
      select 1 from public.organizations o
      where o.id::text = (storage.foldername(name))[1]
        and public.has_org_access(o.id)
    )
  );

-- Same "admin always can; a self-managed client can manage its own org" boundary as
-- organizations_self_managed_branding_update / numbering_configs_self_managed_write
-- (20260919050000_self_managed_org_settings.sql) — the app-layer permission check in
-- lib/branding/actions.ts mirrors this, but the Storage policy is the real enforcement since the
-- browser uploads straight to Storage with the user's own session (same split as vault uploads).
create policy org_branding_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-branding'
    and exists (
      select 1 from public.organizations o
      where o.id::text = (storage.foldername(name))[1]
        and (public.is_jags_staff() or (o.engagement_scope = 'self_managed' and public.has_org_access(o.id)))
    )
  );

-- Re-uploading (upsert) a logo to the same path needs UPDATE too, not just INSERT.
create policy org_branding_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'org-branding'
    and exists (
      select 1 from public.organizations o
      where o.id::text = (storage.foldername(name))[1]
        and (public.is_jags_staff() or (o.engagement_scope = 'self_managed' and public.has_org_access(o.id)))
    )
  );

-- branding_logo_path was deliberately left in restrict_self_managed_org_update()'s blocked-field list
-- (20260919051000_fix_org_update_trigger_service_role_bypass.sql) when that trigger was written —
-- at the time nothing could ever set it, so it defaulted to the same JAGS-only posture as
-- engagement_mode/engagement_scope. It belongs instead with brand_primary_color/brand_accent_color:
-- cosmetic, not a commercial or assurance-integrity decision, so a self-managed client sets its own
-- logo exactly like it already sets its own brand colors. engagement_mode/engagement_scope (the
-- actual commercial-tier decisions) stay blocked, unchanged.
create or replace function public.restrict_self_managed_org_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_jags_staff() then
    if new.name is distinct from old.name
      or new.slug is distinct from old.slug
      or new.is_active is distinct from old.is_active
      or new.engagement_mode is distinct from old.engagement_mode
      or new.engagement_scope is distinct from old.engagement_scope
      or new.ai_consent is distinct from old.ai_consent
    then
      raise exception 'Only a JAGS Admin can change that field.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
