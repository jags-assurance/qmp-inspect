-- Contractors (main contractor and subcontractor) can create ITPs on every project by default.
-- Not yet applied: dev and prod share one database, so apply this deliberately (SQL editor or `pnpm db:push`).
-- The per-project switch (Project settings -> "Allow contractors to create ITPs") still works afterwards, so a
-- project that wants it off can turn it off. The RLS policy and the ITP page already honour this column.

alter table public.projects alter column allow_contractor_itp_creation set default true;

update public.projects set allow_contractor_itp_creation = true where allow_contractor_itp_creation = false;
