-- Data Book revision counter. A new book created on a project that already has an issued book is the
-- next revision (max existing revision + 1); the first book is revision 0. Set by trigger so no
-- application code path can skip or duplicate it.
alter table public.data_books
  add column if not exists revision integer not null default 0;

create or replace function public.data_books_set_revision()
returns trigger
language plpgsql
as $$
begin
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

drop trigger if exists data_books_set_revision on public.data_books;
create trigger data_books_set_revision
  before insert on public.data_books
  for each row execute function public.data_books_set_revision();

-- Issued books are immutable except for the status transitions the app performs: block edits of an
-- issued book's identifying fields.
create or replace function public.data_books_block_issued_edit()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'issued' and (
    new.book_number is distinct from old.book_number
    or new.title is distinct from old.title
    or new.project_id is distinct from old.project_id
    or new.revision is distinct from old.revision
  ) then
    raise exception 'An issued Data Book is immutable; create a new revision instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists data_books_block_issued_edit on public.data_books;
create trigger data_books_block_issued_edit
  before update on public.data_books
  for each row execute function public.data_books_block_issued_edit();
