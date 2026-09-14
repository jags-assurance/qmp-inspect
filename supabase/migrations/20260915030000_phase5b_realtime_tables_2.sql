-- Phase 5b: broadcast the tables the multi-discipline enhancement pass wired <RealtimeRefresh> onto
-- (standalone assignments, punch list, data books, handover, vault documents, KPI-feeding inspection
-- records) — the frontend subscriptions were added in that pass, but a table only actually broadcasts
-- once it's in the supabase_realtime publication, same requirement as the original 5 tables in
-- 20260915020000_phase5_realtime_tables.sql.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'standalone_assignments'
  ) then
    alter publication supabase_realtime add table public.standalone_assignments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'punch_list_items'
  ) then
    alter publication supabase_realtime add table public.punch_list_items;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'data_books'
  ) then
    alter publication supabase_realtime add table public.data_books;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'handover_certificates'
  ) then
    alter publication supabase_realtime add table public.handover_certificates;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vault_documents'
  ) then
    alter publication supabase_realtime add table public.vault_documents;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inspection_records'
  ) then
    alter publication supabase_realtime add table public.inspection_records;
  end if;
end $$;
