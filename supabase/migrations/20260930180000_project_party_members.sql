-- Real gap confirmed by reading party-provisioning.ts + project_parties' own columns
-- (20260909220000_phase1_projects.sql, 20260910070000_phase3_project_party_login_link.sql):
-- a project_parties row has exactly ONE user_id — one login represents that whole party today.
-- The user's ask ("give access to specific people from a party, or the whole party, with an
-- optional custom permission per person") needs a many-people-per-party layer this app never had.
--
-- Deliberately NOT a replacement for project_parties.user_id — that column keeps working exactly
-- as-is (provisionPartyLoginAction, ReassignPartyForm, etc. are all untouched), and stays "the
-- primary contact" for backward compatibility. This table is the ADDITIONAL layer of members.
--
-- Access mechanism is deliberately unchanged too: has_org_access()/has_project_access()
-- (20260909210100_phase0_rls_policies.sql, 20260914000000_fix_project_scoped_access_grants.sql)
-- are not touched by this migration. They already don't filter by party at all today — any
-- access_grants row scoped to this project/org/globally sees the whole project, full stop, and
-- that stays true. What changes is only how many access_grants rows a party's members can produce:
-- previously exactly one (the linked user_id), now one per selected/whole-org member, added and
-- removed by the new party-access-actions.ts, using the exact same insert-a-project-scoped-grant
-- pattern provisionPartyLoginAction already uses. No RLS policy logic changes at all, so the
-- well-audited access boundary (a user needs a real access_grants row to see anything) is preserved
-- exactly as-is — only the source of truth for WHICH users get such a row, per party, is extended.
alter table public.project_parties
  add column access_mode text not null default 'whole_org'
    check (access_mode in ('whole_org', 'selected_people'));

comment on column public.project_parties.access_mode is
  'whole_org: every member added under this party gets standard party-type access automatically. '
  'selected_people: an admin must explicitly add each person who should get access — nobody else '
  'from this party is implied to have it. Either way, actual access is still only ever granted via '
  'a real access_grants row (see project_party_members below) — this column only changes the '
  'admin-facing workflow/expectation, never the enforcement mechanism itself.';

create table public.project_party_members (
  id uuid primary key default gen_random_uuid(),
  project_party_id uuid not null references public.project_parties (id) on delete cascade,
  -- Set once the member has (or already had) a real account; null while only an email has been
  -- entered and no account exists yet (mirrors provisionPartyLoginAction's own "no account yet"
  -- state — this table never creates Supabase Auth accounts itself, see party-access-actions.ts).
  user_id uuid references public.users (id) on delete cascade,
  invited_email text,
  -- 'standard': the party-type's normal access (an access_grants row with role = party_type, same
  -- as provisionPartyLoginAction grants today). 'custom': reuses the EXISTING custom-roles system
  -- (custom_roles/custom_role_assignments, 20260918020000_custom_rbac.sql) instead of a second,
  -- parallel permission model — custom_role_id must point at one of the party's own organisation's
  -- custom roles (or a JAGS-global one).
  permission_mode text not null default 'standard' check (permission_mode in ('standard', 'custom')),
  custom_role_id uuid references public.custom_roles (id) on delete set null,
  granted_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (permission_mode = 'standard' or custom_role_id is not null),
  check (user_id is not null or invited_email is not null)
);

create index project_party_members_party_id_idx on public.project_party_members (project_party_id);
create index project_party_members_user_id_idx on public.project_party_members (user_id);
-- A given real account can only appear once per party (adding them twice would just mean two
-- rows fighting over which permission_mode "wins" with no clear meaning).
create unique index project_party_members_party_user_uidx
  on public.project_party_members (project_party_id, user_id)
  where user_id is not null;

alter table public.project_party_members enable row level security;

-- Same shape as project_parties' own policies (20260909220000_phase1_projects.sql,
-- 20260909210100_phase0_rls_policies.sql's project_parties_select/write) — select follows whoever
-- can already see the parent party's project, write is JAGS-staff-only (party-access-actions.ts is
-- itself further gated app-side to Admin / provision_party_login, same as provisionPartyLoginAction).
create policy project_party_members_select on public.project_party_members
  for select using (
    exists (
      select 1 from public.project_parties pp
      join public.projects p on p.id = pp.project_id
      where pp.id = project_party_members.project_party_id
        and public.has_project_access(p.id, p.organization_id)
    )
  );

create policy project_party_members_write on public.project_party_members
  for all using (
    exists (
      select 1 from public.project_parties pp
      join public.projects p on p.id = pp.project_id
      where pp.id = project_party_members.project_party_id
        and public.is_jags_staff()
        and public.has_project_access(p.id, p.organization_id)
    )
  ) with check (
    exists (
      select 1 from public.project_parties pp
      join public.projects p on p.id = pp.project_id
      where pp.id = project_party_members.project_party_id
        and public.is_jags_staff()
        and public.has_project_access(p.id, p.organization_id)
    )
  );

-- Backfill: every party that already has a linked login gets that same user represented as a
-- 'standard' member row too, so the new members list isn't misleadingly empty for existing data —
-- the primary contact shows up in both places (project_parties.user_id AND this table) rather than
-- looking like they were never added.
insert into public.project_party_members (project_party_id, user_id, permission_mode, created_at)
select id, user_id, 'standard', created_at
from public.project_parties
where user_id is not null
on conflict do nothing;
