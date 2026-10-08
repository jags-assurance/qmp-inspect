-- Per-person assignment of an inspection/checklist activity. Idempotent, additive.
--
-- itp_items.assigned_to_user_id is a nullable column: NULL = not assigned to a specific person (the
-- activity stays open to its party as before). Writes go through assign_activity_to_user(), a
-- SECURITY DEFINER function that enforces the rules in one place rather than widening itp_items RLS:
--   * caller must be JAGS staff, a lead of a client team assigned to the project, or the linked
--     user of an active party on this activity;
--   * the assignee must be JAGS staff or a member (linked user / project_party_members row) of an
--     active party on this activity. NULL clears the assignment.

alter table public.itp_items add column if not exists assigned_to_user_id uuid references public.users (id) on delete set null;
alter table public.itp_items add column if not exists assigned_by uuid references public.users (id) on delete set null;
alter table public.itp_items add column if not exists assigned_at timestamptz;

create index if not exists itp_items_assigned_to_user_id_idx
  on public.itp_items (assigned_to_user_id) where assigned_to_user_id is not null;

create or replace function public.assign_activity_to_user(p_itp_item_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_project uuid;
  v_allowed boolean;
begin
  if v_caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select p.id into v_project
    from public.itp_items i
    join public.itp_sections s on s.id = i.section_id
    join public.itps t on t.id = s.itp_id
    join public.projects p on p.id = t.project_id
   where i.id = p_itp_item_id;
  if v_project is null then
    raise exception 'Activity not found' using errcode = 'P0002';
  end if;

  v_allowed := public.is_jags_staff()
    or exists (
      select 1 from public.client_team_project_assignments cta
       where cta.project_id = v_project and public.is_client_team_lead_of(cta.client_team_id)
    )
    or exists (
      select 1 from public.activity_party_intervention api
        join public.project_parties pp on pp.id = api.project_party_id
       where api.itp_item_id = p_itp_item_id and pp.is_active and pp.user_id = v_caller
    );
  if not v_allowed then
    raise exception 'Only JAGS staff or the executing party''s team lead can assign this activity' using errcode = '42501';
  end if;

  if p_user_id is not null and not (
    exists (select 1 from public.users u where u.id = p_user_id and u.is_jags_staff)
    or exists (
      select 1 from public.activity_party_intervention api
        join public.project_parties pp on pp.id = api.project_party_id
       where api.itp_item_id = p_itp_item_id and pp.is_active
         and (pp.user_id = p_user_id
              or exists (select 1 from public.project_party_members m where m.project_party_id = pp.id and m.user_id = p_user_id))
    )
  ) then
    raise exception 'The assignee must be JAGS staff or a member of a party on this activity' using errcode = '22023';
  end if;

  update public.itp_items
     set assigned_to_user_id = p_user_id,
         assigned_by = case when p_user_id is null then null else v_caller end,
         assigned_at = case when p_user_id is null then null else now() end
   where id = p_itp_item_id;
end;
$$;

revoke all on function public.assign_activity_to_user(uuid, uuid) from public, anon;
grant execute on function public.assign_activity_to_user(uuid, uuid) to authenticated;
