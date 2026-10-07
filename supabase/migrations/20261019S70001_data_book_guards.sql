-- Stage 7: Data Book write guards. Idempotent. Does not touch issued rows.

-- ===== 1. Revision trigger: advisory lock + definer =====
create or replace function public.data_books_set_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Serialise concurrent inserts per project so two books cannot compute the same revision.
  perform pg_advisory_xact_lock(hashtextextended('data_books:' || new.project_id::text, 0));
  if exists (
    select 1 from public.data_books
    where project_id = new.project_id and status = 'issued'
  ) then
    select coalesce(max(revision), 0) + 1 into new.revision
    from public.data_books
    where project_id = new.project_id;
  else
    new.revision := 0;
  end if;
  return new;
end;
$$;
revoke all on function public.data_books_set_revision() from public, anon, authenticated;

-- ===== 2. State-machine / immutability guard =====
create or replace function public.data_books_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_system_caller() or pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then
      raise exception 'A new Data Book must start as draft';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'issued' then
      raise exception 'An issued Data Book cannot be deleted';
    end if;
    if not public.is_admin_staff() then
      raise exception 'Only admin staff can delete a Data Book';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.revision is distinct from old.revision then
    raise exception 'Data Book revision is immutable';
  end if;
  if new.project_id is distinct from old.project_id then
    raise exception 'Data Book project cannot be changed';
  end if;

  -- Issued books never change (status, override_*, compiled_*, anything). The app does not
  -- update any column after issue.
  if old.status = 'issued' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'An issued Data Book is immutable; create a new revision instead';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'compiled' then
      null;
    elsif old.status = 'compiled' and new.status = 'issued' then
      if coalesce(current_setting('app.issue_rpc', true), '') <> '1' then
        raise exception 'Data Books can only be issued through issue_data_book_handover()';
      end if;
      if not exists (select 1 from public.handover_certificates hc where hc.data_book_id = old.id) then
        raise exception 'Cannot issue a Data Book without a handover certificate';
      end if;
    else
      raise exception 'Invalid Data Book status change: % -> %', old.status, new.status;
    end if;
  end if;

  return new;
end;
$$;
revoke all on function public.data_books_guard() from public, anon, authenticated;

drop trigger if exists data_books_guard on public.data_books;
create trigger data_books_guard
  before insert or update or delete on public.data_books
  for each row execute function public.data_books_guard();

-- ===== 3. Uniqueness (only when existing data allows) =====
do $$
begin
  if exists (select 1 from public.data_books group by project_id, revision having count(*) > 1) then
    raise notice 'data_books: duplicate (project_id, revision) rows exist; unique index NOT created';
  else
    create unique index if not exists data_books_project_revision_uidx
      on public.data_books (project_id, revision);
  end if;

  if exists (
    select 1 from public.data_books where status <> 'issued'
    group by project_id having count(*) > 1
  ) then
    raise notice 'data_books: projects with more than one non-issued book exist; partial unique index NOT created';
  else
    create unique index if not exists data_books_one_open_per_project_uidx
      on public.data_books (project_id) where status <> 'issued';
  end if;
end $$;

-- ===== 4. Write policies: staff with project access; delete admin staff only =====
drop policy if exists data_books_staff_write on public.data_books;
drop policy if exists data_books_write on public.data_books;
drop policy if exists data_books_write_i on public.data_books;
drop policy if exists data_books_write_u on public.data_books;
drop policy if exists data_books_write_d on public.data_books;

create policy data_books_write_i on public.data_books for insert with check (
  exists (select 1 from public.projects p
          where p.id = data_books.project_id and public.is_jags_staff()
            and public.has_project_access(p.id, p.organization_id)));
create policy data_books_write_u on public.data_books for update
  using (exists (select 1 from public.projects p
          where p.id = data_books.project_id and public.is_jags_staff()
            and public.has_project_access(p.id, p.organization_id)))
  with check (exists (select 1 from public.projects p
          where p.id = data_books.project_id and public.is_jags_staff()
            and public.has_project_access(p.id, p.organization_id)));
create policy data_books_write_d on public.data_books for delete using (
  exists (select 1 from public.projects p
          where p.id = data_books.project_id and public.is_admin_staff()
            and public.has_project_access(p.id, p.organization_id)));
