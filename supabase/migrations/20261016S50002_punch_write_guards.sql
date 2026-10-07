-- Stage 5: punch list write guards. Mirrors lib/punch-list/actions.ts and the NCR close cascade
-- (lib/ncrs/actions.ts). Exemptions: public.is_system_caller() and pg_trigger_depth() > 1.
-- Idempotent. Depends on 20261015S40001 (is_system_caller) and 20261013N20001 (punch columns).

alter table public.punch_list_items
  add column if not exists closing_photo_paths text[] not null default '{}';

-- ===== 1. Insert guard =====
create or replace function public.punch_list_items_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_system_caller() then
    return new;
  end if;
  new.created_by := auth.uid();
  if new.status is distinct from 'open' then
    raise exception 'A new punch item must start as open';
  end if;
  new.resolved_by := null; new.resolved_at := null;
  new.closed_by := null;   new.closed_at := null;
  new.reopened_by := null; new.reopened_at := null;
  return new;
end;
$$;

revoke all on function public.punch_list_items_guard_insert() from public, anon, authenticated;

drop trigger if exists punch_list_items_guard_insert on public.punch_list_items;
create trigger punch_list_items_guard_insert
  before insert on public.punch_list_items
  for each row execute function public.punch_list_items_guard_insert();

-- ===== 2. Update guard (replaces punch_list_items_guard_transition body; same trigger name) =====
create or replace function public.punch_list_items_guard_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_guarded boolean := not (public.is_system_caller() or pg_trigger_depth() > 1);
  v_staff boolean;
  v_closer boolean;
  v_cascade boolean := old.source_ncr_id is not null;
begin
  if v_guarded then
    v_staff := public.is_jags_staff();
    v_closer := public.is_admin_staff()
      or public.has_custom_permission(v_uid, 'close_punch_item', old.project_id);

    if new.project_id is distinct from old.project_id then
      raise exception 'project_id cannot be changed';
    end if;
    if new.created_by is distinct from old.created_by then
      raise exception 'created_by cannot be changed';
    end if;

    -- Actor/time stamps are server-owned: start from the old values, override per transition.
    new.resolved_by := old.resolved_by; new.resolved_at := old.resolved_at;
    new.closed_by := old.closed_by;     new.closed_at := old.closed_at;
    new.reopened_by := old.reopened_by; new.reopened_at := old.reopened_at;

    if new.status is not distinct from old.status then
      if old.status = 'closed'
         and (new.closing_evidence is distinct from old.closing_evidence
              or new.verification_notes is distinct from old.verification_notes
              or new.closing_photo_paths is distinct from old.closing_photo_paths) then
        raise exception 'Closing evidence cannot be edited once the punch item is closed';
      end if;
    else
      if new.status = 'resolved' and old.status = 'open' then
        if not (v_staff or v_closer or exists (
                  select 1 from public.project_parties pp
                  where pp.id = old.responsible_party_id and pp.user_id = v_uid)) then
          raise exception 'Only the responsible party, JAGS staff or a punch item verifier can mark an item resolved';
        end if;
        if coalesce(btrim(new.closing_evidence), '') = '' then
          raise exception 'Evidence of what was done is required before this item can be marked resolved';
        end if;
        new.resolved_by := v_uid;
        new.resolved_at := now();
      elsif new.status = 'closed' then
        -- NCR close-out cascade: staff closing the source NCR may close open/resolved linked items.
        if not (v_closer or (v_cascade and v_staff and old.status in ('open', 'resolved'))) then
          raise exception 'Only a JAGS admin or a holder of close_punch_item can close a punch item';
        end if;
        new.closed_by := v_uid;
        new.closed_at := now();
      elsif new.status = 'open' then
        -- Reject-fix (resolved -> open) or reopen (closed -> open). The NCR re-open cascade
        -- (closed -> open for NCR-sourced items) is allowed for any staff.
        if not (v_closer or (v_cascade and v_staff and old.status = 'closed')) then
          raise exception 'Only a JAGS admin or a holder of close_punch_item can reopen a punch item';
        end if;
        new.reopened_by := v_uid;
        new.reopened_at := now();
        new.closed_by := null;   new.closed_at := null;
        new.resolved_by := null; new.resolved_at := null;
      end if;
    end if;
  end if;

  -- ---- existing rules (20261013N20001); different-person rule skipped for NCR-sourced items ----
  if new.status is distinct from old.status then
    if old.status = 'open' and new.status = 'closed' and old.source_ncr_id is null then
      raise exception 'A punch item must be resolved before it can be closed';
    end if;
    if new.status = 'closed' then
      if coalesce(btrim(new.verification_notes), '') = '' then
        raise exception 'Verification notes are required to close a punch item';
      end if;
      if old.source_ncr_id is null and new.closed_by is not null and new.closed_by = old.resolved_by then
        raise exception 'A different person must verify and close a punch item';
      end if;
    end if;
    if old.status = 'closed' and new.status <> 'open' then
      raise exception 'A closed punch item can only be reopened';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.punch_list_items_guard_transition() from public, anon, authenticated;

drop trigger if exists punch_list_items_guard_transition on public.punch_list_items;
create trigger punch_list_items_guard_transition
  before update on public.punch_list_items
  for each row execute function public.punch_list_items_guard_transition();

-- ===== 3. Policies: members insert/update, admin staff delete =====
drop policy if exists punch_list_items_write_i on public.punch_list_items;
create policy punch_list_items_write_i on public.punch_list_items for insert with check (
  exists (select 1 from public.projects p where p.id = punch_list_items.project_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists punch_list_items_write_u on public.punch_list_items;
create policy punch_list_items_write_u on public.punch_list_items for update using (
  exists (select 1 from public.projects p where p.id = punch_list_items.project_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = punch_list_items.project_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists punch_list_items_write_d on public.punch_list_items;
create policy punch_list_items_write_d on public.punch_list_items for delete using (
  public.is_admin_staff()
  and exists (select 1 from public.projects p where p.id = punch_list_items.project_id and has_project_access(p.id, p.organization_id))
);
