-- Audit finding (checklist module): "no history of overwritten answers" and "individual answer changes not
-- audited". Every time a recorded answer is changed, the value it had is now kept in an append-only history
-- table, written by a trigger so no code path can skip it. Reopening an inspection (which snapshots the whole
-- previous answer set) is unchanged; this covers the day-to-day edits while an inspection is in progress.
-- Append-only: no update or delete policy. Idempotent.
create table if not exists public.checklist_response_history (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null,
  inspection_record_id uuid not null references public.inspection_records (id) on delete cascade,
  checklist_item_id uuid not null,
  old_result text,
  old_comment text,
  old_numeric_value text,
  old_updated_at timestamptz,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);

create index if not exists checklist_response_history_record_idx
  on public.checklist_response_history (inspection_record_id, changed_at desc);

alter table public.checklist_response_history enable row level security;

drop policy if exists checklist_response_history_select on public.checklist_response_history;
create policy checklist_response_history_select on public.checklist_response_history
  for select to authenticated
  using (exists (
    select 1
    from public.inspection_records r
    join public.projects p on p.id = r.project_id
    where r.id = checklist_response_history.inspection_record_id
      and public.has_project_access(p.id, p.organization_id)
  ));

create or replace function public.checklist_responses_keep_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.result is distinct from old.result
     or new.comment is distinct from old.comment
     or (to_jsonb(new) ->> 'numeric_value') is distinct from (to_jsonb(old) ->> 'numeric_value') then
    insert into public.checklist_response_history
      (response_id, inspection_record_id, checklist_item_id, old_result, old_comment, old_numeric_value, old_updated_at, changed_by)
    values
      (old.id, old.inspection_record_id, old.checklist_item_id, old.result, old.comment, to_jsonb(old) ->> 'numeric_value', old.updated_at, auth.uid());
  end if;
  return new;
end;
$$;

revoke all on function public.checklist_responses_keep_history() from public, anon, authenticated;

drop trigger if exists checklist_responses_keep_history on public.checklist_responses;
create trigger checklist_responses_keep_history
  after update on public.checklist_responses
  for each row execute function public.checklist_responses_keep_history();
