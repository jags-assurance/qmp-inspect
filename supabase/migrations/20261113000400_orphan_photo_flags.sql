-- S4-19: orphaned inspection photos. An upload can succeed in Storage while the matching
-- inspection_photos row is never written (a crash, a lost offline replay). Those objects stay in the
-- inspection-evidence bucket forever. The worker FLAGS them here for an Admin to review; nothing is
-- ever deleted automatically. Only objects under <project_id>/<inspection_record_id>/ are considered,
-- older than the cut-off the worker passes (7 days), with no inspection_photos or vault_documents row
-- pointing at them. Idempotent.
create table if not exists public.orphan_photo_flags (
  storage_path text primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  inspection_record_id uuid not null references public.inspection_records (id) on delete cascade,
  size_bytes bigint,
  object_created_at timestamptz,
  status text not null default 'flagged' check (status in ('flagged', 'kept', 'removed')),
  first_flagged_at timestamptz not null default now(),
  reviewed_by uuid references public.users (id),
  reviewed_at timestamptz,
  review_note text
);

create index if not exists orphan_photo_flags_org_status_idx
  on public.orphan_photo_flags (organization_id, status);

alter table public.orphan_photo_flags enable row level security;

-- Admins read the list; writes happen only through the worker (service role) and review_orphan_photo().
drop policy if exists orphan_photo_flags_select on public.orphan_photo_flags;
create policy orphan_photo_flags_select on public.orphan_photo_flags
  for select to authenticated
  using (public.is_admin_staff() and public.has_org_access(organization_id));

create or replace function public.orphan_photo_candidates(p_created_before timestamptz, p_limit int default 500)
returns table (
  storage_path text,
  project_id uuid,
  organization_id uuid,
  inspection_record_id uuid,
  size_bytes bigint,
  object_created_at timestamptz
)
language sql
security definer
stable
set search_path = public, storage, pg_temp
as $$
  select o.name,
         r.project_id,
         p.organization_id,
         r.id,
         nullif(o.metadata ->> 'size', '')::bigint,
         o.created_at
  from storage.objects o
  join public.inspection_records r
    on r.id::text = split_part(o.name, '/', 2)
   and r.project_id::text = split_part(o.name, '/', 1)
  join public.projects p on p.id = r.project_id
  where o.bucket_id = 'inspection-evidence'
    and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+'
    and o.created_at < p_created_before
    and not exists (select 1 from public.inspection_photos ph where ph.storage_path = o.name)
    and not exists (select 1 from public.vault_documents d where d.storage_path = o.name)
    and not exists (select 1 from public.orphan_photo_flags f where f.storage_path = o.name)
  order by o.created_at
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

revoke all on function public.orphan_photo_candidates(timestamptz, int) from public, anon, authenticated;
grant execute on function public.orphan_photo_candidates(timestamptz, int) to service_role;

-- Admin review: keep the file (it stops being listed as a candidate) or record that it was removed by hand.
create or replace function public.review_orphan_photo(p_storage_path text, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  if not public.is_admin_staff() then
    raise exception 'Only a JAGS Admin can review orphaned photos.' using errcode = '42501';
  end if;
  if p_decision not in ('kept', 'removed') then
    raise exception 'Decision must be kept or removed.' using errcode = '22023';
  end if;
  select organization_id into v_org from public.orphan_photo_flags where storage_path = p_storage_path;
  if v_org is null then
    raise exception 'No such flagged photo.' using errcode = 'P0002';
  end if;
  if not public.has_org_access(v_org) then
    raise exception 'No access to this organisation.' using errcode = '42501';
  end if;
  update public.orphan_photo_flags
     set status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(p_note), '')
   where storage_path = p_storage_path;
end;
$$;

revoke all on function public.review_orphan_photo(text, text, text) from public, anon;
grant execute on function public.review_orphan_photo(text, text, text) to authenticated;
