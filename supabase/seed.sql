-- Local-dev-only reference data. Never run against a staging/production database — these are
-- throwaway demo credentials and organisations.
--
-- IMPORTANT: this file does NOT create the demo user accounts (unlike an earlier version of it).
-- Inserting directly into `auth.users` looks like it works (the row exists, the password hash is
-- valid) but Supabase's Auth server also requires a matching `auth.identities` row that a raw
-- insert doesn't create — sign-in then fails with no useful error. Always create demo/real users
-- through the Supabase Auth Admin API (`supabase.auth.admin.createUser(...)`), never by hand-writing
-- into `auth.users`. See docs/MANUAL_TESTING_GUIDE.md for the actual login credentials in use.
--
-- The five demo accounts that exist in this project's database (all password `DemoPass123!`),
-- created via the Admin API and then linked below to the organisation/project/party data:
--   admin@jagsassurance.local     JAGS staff (Oliver Bennett)        — global access_grants row
--   client@meridian.demo          Meridian's own user (Priya Nair)   — organization-scoped grant
--   subcontractor@voltway.demo    Voltway Electrical Ltd (Sam Rourke)     — project-scoped, role 'subcontractor'
--   contractor@gfl.demo           GFL Engineering & Construction (Maria Alvez) — project-scoped, role 'main_contractor'
--   tpi@bureauveritas.demo        Bureau Veritas (Tom Okafor)        — project-scoped, role 'tpi_lab'
--
-- The three role-based accounts are also linked to their `project_parties` row via `user_id`, which
-- is what actually restricts sign-off actions on the ITP intervention grid to "your own party only"
-- (see lib/signoff/actions.ts's canSignOffForParty). If you need to recreate these accounts from
-- scratch, use the Admin API + the access_grants/project_parties.user_id inserts below as a
-- reference for the ids to use, replacing the `<...-user-id>` placeholders with what the Admin API
-- actually returns.

insert into public.organizations (id, name, slug, engagement_mode)
values ('b0000000-0000-0000-0000-000000000001', 'Meridian Energy', 'meridian', 'co_branded')
on conflict (id) do nothing;

insert into public.projects (id, organization_id, project_number, name, site_location, status)
values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'MER-2026-001', 'Substation Bldg 2 Electrical Upgrade', 'Meridian Energy Site, Bldg 2', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'MER-2026-002', 'LV Switchroom Refurbishment', 'Meridian Energy Site, Bldg 4', 'draft')
on conflict (id) do nothing;

-- A representative multi-party chain on the active project, so the ITP intervention grid and the
-- sign-off workflow (Notify / Sign off / Proceed) have real parties to exercise in a demo. The
-- `user_id` column on the three external parties is filled in separately, after their Admin-API
-- accounts exist (see the note above) — it can't be a literal value here since Admin-API user ids
-- aren't known ahead of time.
insert into public.project_parties (project_id, party_type, name, contact_name, contact_email)
values
  ('c0000000-0000-0000-0000-000000000001', 'subcontractor', 'Voltway Electrical Ltd', 'Sam Rourke', 'sam.rourke@voltway.example'),
  ('c0000000-0000-0000-0000-000000000001', 'main_contractor', 'GFL Engineering & Construction', 'Maria Alvez', 'maria.alvez@gfl.example'),
  ('c0000000-0000-0000-0000-000000000001', 'tpi_lab', 'Bureau Veritas', 'Tom Okafor', 'tom.okafor@bureauveritas.example'),
  ('c0000000-0000-0000-0000-000000000001', 'jags', 'JAGS Assurance', 'Oliver Bennett', 'admin@jagsassurance.local'),
  ('c0000000-0000-0000-0000-000000000001', 'client', 'Meridian Energy', 'Priya Nair', 'client@meridian.demo')
on conflict do nothing;

-- access_grants and project_parties.user_id for the five demo accounts are applied once each
-- account's real Admin-API-issued user id is known — not repeated here as literal SQL to avoid
-- implying they can be safely re-run; see docs/MANUAL_TESTING_GUIDE.md for the actual current ids.
