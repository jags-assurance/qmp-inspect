-- PHASE 3: reviewer approve / reject step for completed inspections. Idempotent and additive:
-- every column is nullable, review_status IS NULL means "no review recorded" and existing flows
-- (completion, IRN issue, re-open) are unchanged.

alter table public.inspection_records add column if not exists review_status text;
alter table public.inspection_records add column if not exists reviewed_by uuid references public.users (id);
alter table public.inspection_records add column if not exists reviewed_at timestamptz;
alter table public.inspection_records add column if not exists review_comment text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inspection_records_review_status_check') then
    alter table public.inspection_records
      add constraint inspection_records_review_status_check
      check (review_status is null or review_status in ('approved', 'rejected'));
  end if;
end $$;

create index if not exists inspection_records_review_status_idx
  on public.inspection_records (project_id, review_status) where review_status is not null;

-- The completed-record freeze guard allowed only narrative edits. A review decision is a second
-- permitted change on a completed record: JAGS staff may change ONLY the review_* columns (and
-- narrative / updated_at). Everything else is unchanged from 20261015S40001.
create or replace function public.inspection_records_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if public.is_system_caller() then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.overall_result is not null then
      raise exception 'A completed inspection cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  if old.overall_result is null then
    return new;
  end if;

  if new.overall_result is null then
    if public.is_jags_staff() then
      return new;
    end if;
    raise exception 'Only JAGS staff can re-open a completed inspection' using errcode = '42501';
  end if;

  -- Narrative and/or review decision on a completed record (staff only).
  if public.is_jags_staff()
     and (to_jsonb(new) - 'narrative' - 'updated_at' - 'review_status' - 'reviewed_by' - 'reviewed_at' - 'review_comment')
       = (to_jsonb(old) - 'narrative' - 'updated_at' - 'review_status' - 'reviewed_by' - 'reviewed_at' - 'review_comment') then
    return new;
  end if;

  raise exception 'Inspection is completed; it can only be changed by re-opening it' using errcode = '42501';
end;
$$;
revoke all on function public.inspection_records_write_guard() from public, anon;
