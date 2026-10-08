-- Plan-limit enforcement: an Admin may exceed an organisation's seat limit on purpose, with a reason.
-- The existing access_grants_org_seat_limit trigger (20260917070000) still blocks every insert over the
-- limit UNLESS an unconsumed override exists for that organisation + user, created in the last 10
-- minutes. The override is consumed by the insert it allows (single use) and stays as the audit record.
-- With no seat_limit set nothing changes. Idempotent.
create table if not exists public.seat_limit_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) >= 5),
  granted_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists seat_limit_overrides_org_idx
  on public.seat_limit_overrides (organization_id, created_at desc);

alter table public.seat_limit_overrides enable row level security;

drop policy if exists seat_limit_overrides_admin_select on public.seat_limit_overrides;
create policy seat_limit_overrides_admin_select on public.seat_limit_overrides
  for select to authenticated using (public.is_admin_staff());

drop policy if exists seat_limit_overrides_admin_insert on public.seat_limit_overrides;
create policy seat_limit_overrides_admin_insert on public.seat_limit_overrides
  for insert to authenticated with check (public.is_admin_staff());

drop policy if exists seat_limit_overrides_admin_delete on public.seat_limit_overrides;
create policy seat_limit_overrides_admin_delete on public.seat_limit_overrides
  for delete to authenticated using (public.is_admin_staff() and consumed_at is null);

create or replace function public.enforce_access_grants_org_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seat_limit int;
  v_user_already_counted boolean;
  v_existing_distinct_users int;
  v_override uuid;
begin
  if new.organization_id is null then
    return new;
  end if;

  select seat_limit into v_seat_limit
  from public.organization_plans
  where organization_id = new.organization_id;

  if v_seat_limit is null then
    return new;
  end if;

  select exists (
    select 1 from public.access_grants ag
    where ag.organization_id = new.organization_id and ag.user_id = new.user_id
  ) into v_user_already_counted;

  if v_user_already_counted then
    return new;
  end if;

  select count(distinct ag.user_id) into v_existing_distinct_users
  from public.access_grants ag
  where ag.organization_id = new.organization_id;

  if v_existing_distinct_users + 1 > v_seat_limit then
    select o.id into v_override
    from public.seat_limit_overrides o
    where o.organization_id = new.organization_id
      and o.user_id = new.user_id
      and o.consumed_at is null
      and o.created_at > now() - interval '10 minutes'
    order by o.created_at desc
    limit 1
    for update;

    if v_override is not null then
      update public.seat_limit_overrides set consumed_at = now() where id = v_override;
      return new;
    end if;

    raise exception 'This organisation has reached its seat limit (%) — remove an existing access grant or raise the seat limit before adding another.', v_seat_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
