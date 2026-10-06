-- Punch list: A/B/C priority, photos, creator, reopen tracking, and a DB-level guard on status
-- transitions so the two-step independent close cannot be bypassed by a direct API update.

alter table public.punch_list_items
  add column if not exists priority text not null default 'B' check (priority in ('A', 'B', 'C')),
  add column if not exists photo_paths text[] not null default '{}',
  add column if not exists created_by uuid references public.users (id),
  add column if not exists reopen_reason text,
  add column if not exists reopened_by uuid references public.users (id),
  add column if not exists reopened_at timestamptz,
  add column if not exists reopen_count integer not null default 0;

create index if not exists punch_list_items_project_status_idx
  on public.punch_list_items (project_id, status);
create index if not exists punch_list_items_created_by_idx on public.punch_list_items (created_by);
create index if not exists punch_list_items_reopened_by_idx on public.punch_list_items (reopened_by);

create or replace function public.punch_list_items_guard_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    -- An item fed by an NCR is closed by that NCR's own independent close-out (lib/ncrs/actions.ts), so open -> closed is
    -- allowed for it; every other item must be resolved first.
    if old.status = 'open' and new.status = 'closed' and old.source_ncr_id is null then
      raise exception 'A punch item must be resolved before it can be closed';
    end if;
    if new.status = 'closed' then
      if coalesce(btrim(new.verification_notes), '') = '' then
        raise exception 'Verification notes are required to close a punch item';
      end if;
      if new.closed_by is not null and new.closed_by = old.resolved_by then
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

drop trigger if exists punch_list_items_guard_transition on public.punch_list_items;
create trigger punch_list_items_guard_transition
  before update on public.punch_list_items
  for each row execute function public.punch_list_items_guard_transition();
