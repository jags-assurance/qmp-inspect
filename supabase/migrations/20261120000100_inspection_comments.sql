-- Reviewer comment threads on completed inspections.
--
-- A comment belongs to one inspection record. Replies attach to a top-level comment (one level of
-- threading: a reply's parent must itself be top-level). Top-level comments can be resolved by
-- JAGS staff. There is deliberately no delete path for clients: no DELETE policy, DELETE revoked.
--
--   read    anyone who can see the inspection's project (same rule as inspection_records_select)
--   insert  anyone with project access, only on a COMPLETED inspection of a writable project;
--           author_id is forced to auth.uid() by the trigger
--   update  the author may edit the body within 15 minutes of posting; JAGS staff may resolve /
--           unresolve a top-level comment; nothing else ever changes
-- Service role / SQL editor (is_system_caller) bypass the trigger checks. Forward-only, idempotent.

create table if not exists public.inspection_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  inspection_record_id uuid not null references public.inspection_records (id) on delete cascade,
  parent_id uuid references public.inspection_comments (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.users (id),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references public.users (id),
  -- Resolution only exists on top-level comments, and both columns travel together.
  constraint inspection_comments_resolve_top_level check (
    (resolved_at is null and resolved_by is null) or (parent_id is null and resolved_at is not null and resolved_by is not null)
  )
);

create index if not exists inspection_comments_record_idx on public.inspection_comments (inspection_record_id, created_at);
create index if not exists inspection_comments_project_idx on public.inspection_comments (project_id);
create index if not exists inspection_comments_parent_idx on public.inspection_comments (parent_id) where parent_id is not null;

alter table public.inspection_comments enable row level security;

drop policy if exists inspection_comments_select on public.inspection_comments;
create policy inspection_comments_select on public.inspection_comments
  for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = inspection_comments.project_id
      and public.has_project_access(p.id, p.organization_id)
  ));

drop policy if exists inspection_comments_insert on public.inspection_comments;
create policy inspection_comments_insert on public.inspection_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1
      from public.inspection_records r
      join public.projects p on p.id = r.project_id
      where r.id = inspection_comments.inspection_record_id
        and r.project_id = inspection_comments.project_id
        and r.overall_result is not null
        and public.has_project_access(p.id, p.organization_id)
    )
  );

-- Row-level: the author (edit) or JAGS staff (resolve). Which columns may change is the trigger's job.
drop policy if exists inspection_comments_update on public.inspection_comments;
create policy inspection_comments_update on public.inspection_comments
  for update to authenticated
  using (
    (author_id = auth.uid() or public.is_jags_staff())
    and exists (
      select 1 from public.projects p
      where p.id = inspection_comments.project_id
        and public.has_project_access(p.id, p.organization_id)
    )
  )
  with check (
    (author_id = auth.uid() or public.is_jags_staff())
    and exists (
      select 1 from public.projects p
      where p.id = inspection_comments.project_id
        and public.has_project_access(p.id, p.organization_id)
    )
  );

-- No DELETE policy exists; also drop the privilege so the API never offers it.
revoke all on public.inspection_comments from anon;
revoke delete, truncate on public.inspection_comments from authenticated;
grant select, insert, update on public.inspection_comments to authenticated;

create or replace function public.inspection_comments_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_record record;
  v_parent record;
  v_body_changed boolean;
  v_resolve_changed boolean;
begin
  if public.is_system_caller() or pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select r.project_id, r.overall_result into v_record
      from public.inspection_records r where r.id = new.inspection_record_id;
    if not found then
      raise exception 'Inspection record not found' using errcode = '23503';
    end if;
    if v_record.overall_result is null then
      raise exception 'Comments can only be added to a completed inspection' using errcode = '42501';
    end if;
    if not public.project_is_writable(v_record.project_id) then
      raise exception 'This project is completed or cancelled; changes are not allowed' using errcode = '42501';
    end if;

    -- Server-owned columns.
    new.project_id := v_record.project_id;
    new.author_id := v_uid;
    new.created_at := now();
    new.edited_at := null;
    new.resolved_at := null;
    new.resolved_by := null;
    new.body := btrim(new.body);

    if new.parent_id is not null then
      select c.inspection_record_id, c.parent_id into v_parent
        from public.inspection_comments c where c.id = new.parent_id;
      if not found or v_parent.inspection_record_id <> new.inspection_record_id then
        raise exception 'The comment being replied to does not belong to this inspection' using errcode = '23503';
      end if;
      if v_parent.parent_id is not null then
        raise exception 'Reply to the top-level comment; threads are one level deep' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.id is distinct from old.id
     or new.project_id is distinct from old.project_id
     or new.inspection_record_id is distinct from old.inspection_record_id
     or new.parent_id is distinct from old.parent_id
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the body or resolution of a comment can change' using errcode = '42501';
  end if;

  if not public.project_is_writable(old.project_id) then
    raise exception 'This project is completed or cancelled; changes are not allowed' using errcode = '42501';
  end if;

  v_body_changed := new.body is distinct from old.body;
  v_resolve_changed := new.resolved_at is distinct from old.resolved_at or new.resolved_by is distinct from old.resolved_by;

  if v_body_changed and v_resolve_changed then
    raise exception 'Edit and resolve are separate changes' using errcode = '42501';
  end if;

  if v_body_changed then
    if old.author_id is distinct from v_uid then
      raise exception 'Only the author can edit a comment' using errcode = '42501';
    end if;
    if now() - old.created_at > interval '15 minutes' then
      raise exception 'A comment can only be edited within 15 minutes of posting' using errcode = '42501';
    end if;
    new.body := btrim(new.body);
    new.edited_at := now();
    new.resolved_at := old.resolved_at;
    new.resolved_by := old.resolved_by;
  elsif v_resolve_changed then
    if not public.is_jags_staff() then
      raise exception 'Only JAGS staff can resolve a comment' using errcode = '42501';
    end if;
    if old.parent_id is not null then
      raise exception 'Only a top-level comment can be resolved' using errcode = '23514';
    end if;
    if new.resolved_at is null then
      new.resolved_by := null;
    else
      new.resolved_at := now();
      new.resolved_by := v_uid;
    end if;
    new.edited_at := old.edited_at;
  else
    new.edited_at := old.edited_at;
  end if;

  return new;
end;
$$;

revoke all on function public.inspection_comments_guard() from public, anon, authenticated;

drop trigger if exists inspection_comments_guard on public.inspection_comments;
create trigger inspection_comments_guard
  before insert or update on public.inspection_comments
  for each row execute function public.inspection_comments_guard();
