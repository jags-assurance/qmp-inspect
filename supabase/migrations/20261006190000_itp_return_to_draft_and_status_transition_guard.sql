-- Reviewer can send an ITP back to the preparer with a reason.
alter table public.itps
  add column if not exists returned_by uuid,
  add column if not exists returned_at timestamptz,
  add column if not exists returned_reason text;

-- Only legal status transitions: draft -> under_review -> approved -> client_accepted, plus
-- under_review -> draft (returned). Direct API writes can no longer jump a status (e.g. draft -> approved)
-- or reopen an approved ITP.
create or replace function public.itps_guard_status_transition()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status = 'under_review')
      or (old.status = 'under_review' and new.status in ('approved', 'draft'))
      or (old.status = 'approved' and new.status = 'client_accepted')
    ) then
      raise exception 'Illegal ITP status change: % -> %', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists itps_guard_status_transition on public.itps;
create trigger itps_guard_status_transition before update of status on public.itps
  for each row execute function public.itps_guard_status_transition();
