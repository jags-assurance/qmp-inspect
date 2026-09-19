-- Closes the last piece of "the client manages its own organization": today a Self-Managed client
-- could create its own projects/teams/roles/parties, but couldn't touch its own organization's
-- branding colors or document numbering format — both stayed JAGS-Admin-only, same as they are for
-- a full_service client. Brand colors and numbering are cosmetic/administrative, not commercial or
-- assurance-integrity decisions (unlike engagement_scope itself, or engagement_mode, which stay
-- JAGS-only — a client shouldn't be able to unilaterally declare its own service tier or branding
-- arrangement), so widening just these two is safe.

-- numbering_configs already carries organization_id, so this is a direct OR-branch widening, same
-- shape as every other self_managed policy this session added.
create policy numbering_configs_self_managed_write on public.numbering_configs
  for all
  using (
    exists (select 1 from public.organizations o where o.id = organization_id and o.engagement_scope = 'self_managed')
    and public.has_org_access(organization_id)
  )
  with check (
    exists (select 1 from public.organizations o where o.id = organization_id and o.engagement_scope = 'self_managed')
    and public.has_org_access(organization_id)
  );

-- organizations has no organization_id column on itself (it IS the organization), and unlike
-- numbering_configs its row holds many fields a client must never touch (name, slug, is_active,
-- engagement_mode, engagement_scope, ai_consent, branding_logo_path) alongside the two
-- (brand_primary_color, brand_accent_color) it should be able to. RLS alone can't restrict which
-- COLUMNS an update touches, only which ROWS — so the policy permits the row, and a trigger blocks
-- any non-staff caller from changing anything except the two brand color columns.
create policy organizations_self_managed_branding_update on public.organizations
  for update
  using (engagement_scope = 'self_managed' and public.has_org_access(id))
  with check (engagement_scope = 'self_managed' and public.has_org_access(id));

create or replace function public.restrict_self_managed_org_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_jags_staff() then
    if new.name is distinct from old.name
      or new.slug is distinct from old.slug
      or new.is_active is distinct from old.is_active
      or new.engagement_mode is distinct from old.engagement_mode
      or new.engagement_scope is distinct from old.engagement_scope
      or new.ai_consent is distinct from old.ai_consent
      or new.branding_logo_path is distinct from old.branding_logo_path
    then
      raise exception 'Only a JAGS Admin can change that field.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger organizations_restrict_self_managed_update
  before update on public.organizations
  for each row execute function public.restrict_self_managed_org_update();
