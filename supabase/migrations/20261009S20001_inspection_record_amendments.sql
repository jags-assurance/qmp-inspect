-- Immutable history of inspections re-opened (amended) after sign-off. Rows are insert-only:
-- no update/delete policy exists, so the original signed result is preserved permanently.
create table if not exists public.inspection_record_amendments (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.inspection_records (id) on delete cascade,
  amended_by uuid references public.users (id),
  amended_at timestamptz not null default now(),
  reason text not null check (char_length(btrim(reason)) >= 15),
  previous_overall_result text,
  previous_signed_by_name text,
  previous_signed_at timestamptz,
  previous_notes text
);

create index if not exists inspection_record_amendments_record_idx
  on public.inspection_record_amendments (record_id, amended_at desc);

alter table public.inspection_record_amendments enable row level security;

create policy inspection_record_amendments_select on public.inspection_record_amendments
  for select using (
    exists (
      select 1 from public.inspection_records r
      join public.projects p on p.id = r.project_id
      where r.id = inspection_record_amendments.record_id and public.has_org_access(p.organization_id)
    )
  );

create policy inspection_record_amendments_insert on public.inspection_record_amendments
  for insert to authenticated
  with check (
    public.is_jags_staff()
    and exists (
      select 1 from public.inspection_records r
      join public.projects p on p.id = r.project_id
      where r.id = inspection_record_amendments.record_id and public.has_org_access(p.organization_id)
    )
  );
