-- M2: freeze what was certified. Written once by the worker on the first render of an issued Data Book;
-- later re-renders compare their content hash against it and record a mismatch instead of replacing anything.
-- Idempotent. Rollback: drop table if exists public.data_book_issue_snapshots;
create table if not exists public.data_book_issue_snapshots (
  data_book_id uuid primary key references public.data_books (id) on delete cascade,
  content_hash text not null,
  as_of date,
  readiness jsonb not null default '{}'::jsonb,
  content_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.data_book_issue_snapshots enable row level security;
-- No policies: service-role (worker) only. Immutable once written.
create or replace function public.data_book_issue_snapshots_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'data_book_issue_snapshots rows are immutable';
end $$;
drop trigger if exists data_book_issue_snapshots_no_update on public.data_book_issue_snapshots;
create trigger data_book_issue_snapshots_no_update before update on public.data_book_issue_snapshots
  for each row execute function public.data_book_issue_snapshots_immutable();
