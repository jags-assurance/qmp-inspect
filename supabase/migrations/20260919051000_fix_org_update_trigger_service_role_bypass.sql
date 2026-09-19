-- Fixes a real gap in restrict_self_managed_org_update() (20260919050000_self_managed_org_settings.sql),
-- found while reverting test data through a direct/service-role SQL connection: the trigger checked
-- is_jags_staff(), which resolves auth.uid() to look up the caller's staff flag — but auth.uid() is
-- null for any connection with no Supabase Auth JWT at all (a service-role/superuser connection, an
-- admin script, a migration). Unlike an RLS POLICY (which a service-role connection bypasses
-- entirely via BYPASSRLS), a TRIGGER always fires regardless of BYPASSRLS — so this trigger
-- incorrectly treated "no user session at all" the same as "a real, logged-in, non-staff client,"
-- blocking legitimate backend/admin access that never goes through the app's own session-bound
-- Supabase client. The app itself never hits this gap (createSupabaseServerClient() always carries
-- a real user session), but any direct administrative SQL access would have.
--
-- Fix: only apply the restriction when there IS an authenticated, non-staff user — auth.uid() is
-- null means bypass (already-elevated/backend context, not a workaround).
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
      or new.branding_logo_path is distinct from old.branding_logo_path
    then
      raise exception 'Only a JAGS Admin can change that field.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
