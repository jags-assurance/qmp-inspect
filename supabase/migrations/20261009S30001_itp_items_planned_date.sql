-- Planned date per ITP activity (drives notice-period warnings, overdue / due-soon chips).
alter table public.itp_items add column if not exists planned_date date;
create index if not exists itp_items_planned_date_idx on public.itp_items (planned_date) where planned_date is not null;
