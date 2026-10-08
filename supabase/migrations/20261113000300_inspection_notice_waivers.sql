-- S4-07: a written waiver for a Witness point whose party was never notified.
-- Completing an inspection is refused while a Witness sign-off on the activity is still 'pending'
-- (never notified). JAGS staff can now record a dated, reasoned waiver for ONE inspection record, which
-- lets that inspection complete. Append-only: no update or delete policy, so a waiver can't be edited
-- away afterwards. Idempotent.
create table if not exists public.inspection_notice_waivers (
  id uuid primary key default gen_random_uuid(),
  inspection_record_id uuid not null references public.inspection_records (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  intervention text not null,
  reason text not null check (char_length(btrim(reason)) >= 10),
  waived_by uuid not null default auth.uid() references public.users (id),
  waived_at timestamptz not null default now(),
  unique (inspection_record_id, intervention)
);

create index if not exists inspection_notice_waivers_project_idx
  on public.inspection_notice_waivers (project_id);

alter table public.inspection_notice_waivers enable row level security;

drop policy if exists inspection_notice_waivers_select on public.inspection_notice_waivers;
create policy inspection_notice_waivers_select on public.inspection_notice_waivers
  for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = inspection_notice_waivers.project_id
      and public.has_project_access(p.id, p.organization_id)
  ));

drop policy if exists inspection_notice_waivers_insert on public.inspection_notice_waivers;
create policy inspection_notice_waivers_insert on public.inspection_notice_waivers
  for insert to authenticated
  with check (
    public.is_jags_staff()
    and waived_by = auth.uid()
    and exists (
      select 1
      from public.inspection_records r
      join public.projects p on p.id = r.project_id
      where r.id = inspection_notice_waivers.inspection_record_id
        and r.project_id = inspection_notice_waivers.project_id
        and r.overall_result is null
        and public.has_project_access(p.id, p.organization_id)
    )
  );
