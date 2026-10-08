-- Phase 5 / E-09: AI consent hardening. Consent to send an organisation's content to the AI provider is
-- now attributable: who switched it on or off and when is stamped on the organisation and kept in an
-- append-only history. Idempotent. Does not edit earlier migrations.

alter table public.organizations
  add column if not exists ai_consent_at timestamptz,
  add column if not exists ai_consent_by uuid references public.users (id) on delete set null;

-- Existing consents have no recorded actor; mark the moment this migration ran so the stamp is never blank.
-- (Runs before the stamping trigger exists, which would otherwise keep the old, empty value.)
update public.organizations set ai_consent_at = now() where ai_consent and ai_consent_at is null;

create table if not exists public.ai_consent_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  consent boolean not null,
  changed_by uuid references public.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  note text
);
create index if not exists ai_consent_history_org_idx on public.ai_consent_history (organization_id, changed_at desc);

alter table public.ai_consent_history enable row level security;

-- Readable by JAGS Admins only; written only by the trigger below (security definer). No insert / update /
-- delete policy exists, so nobody can edit the record.
drop policy if exists ai_consent_history_select on public.ai_consent_history;
create policy ai_consent_history_select on public.ai_consent_history for select using (public.is_admin_staff());

create or replace function public.organizations_stamp_ai_consent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.ai_consent then
      new.ai_consent_at := now();
      new.ai_consent_by := auth.uid();
    end if;
    return new;
  end if;
  if new.ai_consent is distinct from old.ai_consent then
    new.ai_consent_at := now();
    new.ai_consent_by := auth.uid();
  else
    -- The stamp can only change together with the consent itself.
    new.ai_consent_at := old.ai_consent_at;
    new.ai_consent_by := old.ai_consent_by;
  end if;
  return new;
end;
$$;
revoke all on function public.organizations_stamp_ai_consent() from public, anon, authenticated;

drop trigger if exists organizations_stamp_ai_consent on public.organizations;
create trigger organizations_stamp_ai_consent before insert or update on public.organizations
  for each row execute function public.organizations_stamp_ai_consent();

create or replace function public.organizations_log_ai_consent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' and new.ai_consent) or (tg_op = 'UPDATE' and new.ai_consent is distinct from old.ai_consent) then
    insert into public.ai_consent_history (organization_id, consent, changed_by)
    values (new.id, new.ai_consent, auth.uid());
  end if;
  return null;
end;
$$;
revoke all on function public.organizations_log_ai_consent() from public, anon, authenticated;

drop trigger if exists organizations_log_ai_consent on public.organizations;
create trigger organizations_log_ai_consent after insert or update on public.organizations
  for each row execute function public.organizations_log_ai_consent();
