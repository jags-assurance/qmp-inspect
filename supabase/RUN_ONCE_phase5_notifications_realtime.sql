-- RUN THIS ONCE in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
--
-- Adds three things, requested together: real in-app notifications (replacing the previously
-- decorative bell), Realtime broadcast on the tables multiple parties look at at the same time, and
-- a transaction-safe checklist-generation function. Combines, unchanged, the three new migration
-- files already committed to supabase/migrations/ (20260915000000, 20260915010000, 20260915020000)
-- into one script so it can be run in a single pass, matching how earlier catch-up scripts in this
-- project were handled. Safe to re-run (every statement is idempotent or additive).

-- ============================================================================================
-- 1. notifications table + RLS + Realtime
-- ============================================================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  recipient_user_id uuid not null references public.users (id) on delete cascade,
  title text not null,
  body text,
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx on public.notifications (recipient_user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (recipient_user_id = auth.uid());

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (public.has_org_access(organization_id));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ============================================================================================
-- 2. Atomic checklist insert (transaction safety for generateChecklistsForItp)
-- ============================================================================================

create or replace function public.insert_checklists_atomic(templates jsonb)
returns table (id uuid, itp_item_id uuid)
language plpgsql
security invoker
as $$
declare
  tmpl jsonb;
  new_template_id uuid;
  item jsonb;
begin
  for tmpl in select * from jsonb_array_elements(templates)
  loop
    insert into public.checklist_templates (itp_item_id, checklist_number, name)
    values (
      (tmpl ->> 'itp_item_id')::uuid,
      tmpl ->> 'checklist_number',
      tmpl ->> 'name'
    )
    returning public.checklist_templates.id into new_template_id;

    for item in select * from jsonb_array_elements(tmpl -> 'items')
    loop
      insert into public.checklist_items (template_id, item_number, description, is_mandatory, sort_order)
      values (
        new_template_id,
        item ->> 'item_number',
        item ->> 'description',
        coalesce((item ->> 'is_mandatory')::boolean, true),
        coalesce((item ->> 'sort_order')::int, 0)
      );
    end loop;

    id := new_template_id;
    itp_item_id := (tmpl ->> 'itp_item_id')::uuid;
    return next;
  end loop;
end;
$$;

-- ============================================================================================
-- 3. Realtime broadcast on the other tables multiple parties watch together
-- ============================================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_signoff_progress'
  ) then
    alter publication supabase_realtime add table public.activity_signoff_progress;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'itps'
  ) then
    alter publication supabase_realtime add table public.itps;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ncrs'
  ) then
    alter publication supabase_realtime add table public.ncrs;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'checklist_responses'
  ) then
    alter publication supabase_realtime add table public.checklist_responses;
  end if;
end $$;

-- ============================================================================================
-- Verify: lists every table now broadcasting via Realtime, and confirms the function exists.
-- Expect notifications, activity_signoff_progress, itps, ncrs, checklist_responses in the first
-- result, and one row (insert_checklists_atomic) in the second.
-- ============================================================================================
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by tablename;
select proname from pg_proc where proname = 'insert_checklists_atomic';
