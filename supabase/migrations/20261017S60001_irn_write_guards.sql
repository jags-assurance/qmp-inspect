-- IRN write guards (DB-layer mirror of issueIrnAction / voidIrnAction / reopenInspectionAction).
-- Before: irns_write_i/u/d only required project access, so any project member could insert an IRN
-- for any record, edit irn_number, un-void, or delete one via the API. Idempotent.
--   * INSERT: project access AND (JAGS staff OR the executing party of the record's activity;
--     mirrors canExecuteItpItem in apps/web/lib/checklists/execution-parties.ts), record must be
--     pass/partial, issued_by forced to auth.uid().
--   * UPDATE: JAGS staff only; only voided_at/voided_by/void_reason may change; never un-void.
--   * DELETE: no policy for authenticated (service_role / postgres / cascades still work).
-- Needs projects.allow_client_execution and organizations.engagement_scope.

-- ===== 0. project_id column (needed for a per-project unique irn_number) =====
alter table public.irns add column if not exists project_id uuid references public.projects (id) on delete cascade;

update public.irns i
   set project_id = r.project_id
  from public.inspection_records r
 where r.id = i.inspection_record_id and i.project_id is null;

create index if not exists irns_project_id_idx on public.irns (project_id);

-- ===== 1. Helper: may the caller execute (and so issue the IRN for) this inspection record? =====
create or replace function public.can_issue_irn_for_record(target_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_jags_staff()
    or exists (
      select 1
      from public.inspection_records r
      join public.projects p on p.id = r.project_id
      join public.organizations o on o.id = p.organization_id
      join public.activity_party_intervention api on api.itp_item_id = r.itp_item_id
      join public.project_parties pp on pp.id = api.project_party_id
      where r.id = target_record_id
        and pp.project_id = r.project_id
        and pp.is_active
        and (
          pp.party_type in ('subcontractor', 'main_contractor')
          or (
            pp.party_type = 'client'
            and (p.allow_client_execution or o.engagement_scope in ('self_managed', 'client_managed'))
          )
        )
        and (
          pp.user_id = auth.uid()
          or exists (
            select 1 from public.project_party_members m
            where m.project_party_id = pp.id and m.user_id = auth.uid()
          )
        )
    );
$$;

revoke all on function public.can_issue_irn_for_record(uuid) from public, anon;
grant execute on function public.can_issue_irn_for_record(uuid) to authenticated, service_role;

-- ===== 2. Policies =====
drop policy if exists irns_write on public.irns;
drop policy if exists irns_write_i on public.irns;
drop policy if exists irns_write_u on public.irns;
drop policy if exists irns_write_d on public.irns;

create policy irns_write_i on public.irns for insert to authenticated with check (
  exists (
    select 1 from public.inspection_records r
    join public.projects p on p.id = r.project_id
    where r.id = irns.inspection_record_id and has_project_access(p.id, p.organization_id)
  )
  and public.can_issue_irn_for_record(irns.inspection_record_id)
);

create policy irns_write_u on public.irns for update to authenticated
using (
  public.is_jags_staff()
  and exists (
    select 1 from public.inspection_records r
    join public.projects p on p.id = r.project_id
    where r.id = irns.inspection_record_id and has_project_access(p.id, p.organization_id)
  )
)
with check (
  public.is_jags_staff()
  and exists (
    select 1 from public.inspection_records r
    join public.projects p on p.id = r.project_id
    where r.id = irns.inspection_record_id and has_project_access(p.id, p.organization_id)
  )
);
-- No DELETE policy: IRNs are never deleted by users (void instead).

-- ===== 3. Trigger =====
create or replace function public.irns_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result text;
  v_project uuid;
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    if tg_op = 'INSERT' and new.project_id is null then
      select r.project_id into new.project_id from public.inspection_records r where r.id = new.inspection_record_id;
    end if;
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'An IRN cannot be deleted; void it instead' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    select r.overall_result, r.project_id into v_result, v_project
      from public.inspection_records r where r.id = new.inspection_record_id;
    if v_result is null or v_result not in ('pass', 'partial') then
      raise exception 'An IRN can only be issued from a passed (or conditionally passed) inspection' using errcode = '42501';
    end if;
    new.project_id := v_project;
    new.issued_by := auth.uid();
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
    return new;
  end if;

  -- UPDATE: only the void columns may change.
  if (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason')
     is distinct from (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
    raise exception 'An issued IRN is immutable (only voiding is allowed)' using errcode = '42501';
  end if;
  if old.voided_at is not null then
    if new.voided_at is distinct from old.voided_at
       or new.voided_by is distinct from old.voided_by
       or new.void_reason is distinct from old.void_reason then
      raise exception 'A voided IRN cannot be changed or reinstated' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.voided_at is not null then
    if new.void_reason is null or length(btrim(new.void_reason)) = 0 then
      raise exception 'A reason is required to void an IRN' using errcode = '42501';
    end if;
    new.voided_by := auth.uid();
  elsif new.voided_by is not null or new.void_reason is not null then
    raise exception 'Void details can only be set when voiding' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.irns_write_guard() from public, anon, authenticated;

drop trigger if exists irns_write_guard on public.irns;
create trigger irns_write_guard
  before insert or update or delete on public.irns
  for each row execute function public.irns_write_guard();

-- ===== 4. Unique irn_number per project (skipped if existing data has duplicates) =====
do $$
begin
  if exists (
    select 1 from public.irns where project_id is not null
    group by project_id, irn_number having count(*) > 1
  ) then
    raise notice 'irns: duplicate (project_id, irn_number) rows exist; unique index irns_project_number_key NOT created';
  else
    create unique index if not exists irns_project_number_key on public.irns (project_id, irn_number);
  end if;
end $$;
