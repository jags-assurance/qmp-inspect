-- G-01: time zone for dates.
--
-- Server components render in the server's zone (UTC on Vercel) and client components in the
-- browser's, so the same timestamp could show different text between server render and hydration, and
-- "due today" flipped hours early or late for a site east or west of UTC. Each project now carries an
-- IANA time zone (default 'UTC', so nothing changes until someone sets it) and each organisation a
-- default that new projects are created with. The app passes the project zone to every formatter
-- (apps/web/lib/dates/format.ts). Idempotent.

alter table public.organizations add column if not exists default_timezone text not null default 'UTC';
alter table public.projects add column if not exists timezone text not null default 'UTC';

-- Reject obviously invalid names early; the app also falls back to UTC if a zone is ever unknown.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_timezone_valid') then
    alter table public.projects
      add constraint projects_timezone_valid
      check (timezone ~ '^[A-Za-z0-9_+\-]+(/[A-Za-z0-9_+\-]+){0,2}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_default_timezone_valid') then
    alter table public.organizations
      add constraint organizations_default_timezone_valid
      check (default_timezone ~ '^[A-Za-z0-9_+\-]+(/[A-Za-z0-9_+\-]+){0,2}$') not valid;
  end if;
end $$;

comment on column public.projects.timezone is 'IANA time zone used to display and compare dates for this project (default UTC).';
comment on column public.organizations.default_timezone is 'IANA time zone new projects of this organisation start with (default UTC).';
