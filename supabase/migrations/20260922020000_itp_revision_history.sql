-- R101 (requirements audit): "ITP revisions (Rev A/0/1…), frozen on issue, visible history table."
-- itps.revision has existed since phase1 but was never actually incremented anywhere — an approved
-- or client-accepted ITP could be edited in place with zero history preserved. The only content-edit
-- path reachable after issue is addItpItemAction (item_items_write RLS allows JAGS staff to add an
-- item at any status; is_client_itp_creator is draft-only, so a client edit never needs this).
--
-- itp_revisions freezes what the document looked like AT a given revision number, at the moment it
-- was superseded — the live itps/itp_sections/itp_items tables always hold the CURRENT (highest)
-- revision's content. Revision 0's snapshot is written at the moment of initial approval (the first
-- "issue"); each subsequent post-approval edit snapshots the pre-edit state before bumping
-- itps.revision.

create table public.itp_revisions (
  id uuid primary key default gen_random_uuid(),
  itp_id uuid not null references public.itps (id) on delete cascade,
  revision int not null,
  title text not null,
  scope text,
  applicable_standard text,
  -- Frozen array of {section_number, title, sort_order, items: [...]} — a plain JSON snapshot
  -- rather than a parallel set of historical rows, since this is a point-in-time record never
  -- queried relationally, only rendered back as-is.
  sections_snapshot jsonb not null,
  reason text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  unique (itp_id, revision)
);

create index itp_revisions_itp_id_idx on public.itp_revisions (itp_id);

alter table public.itp_revisions enable row level security;

create policy itp_revisions_select on public.itp_revisions
  for select using (
    exists (
      select 1 from public.itps i
      join public.projects p on p.id = i.project_id
      where i.id = itp_revisions.itp_id and public.has_org_access(p.organization_id)
    )
  );

-- Insert-only from here (a revision snapshot is never edited or deleted once written) — mirrors
-- itps_staff_write's is_jags_staff() + has_org_access() gate, since JAGS staff is the only party
-- that can ever trigger a post-issue content edit in the first place (see comment above).
create policy itp_revisions_staff_insert on public.itp_revisions
  for insert
  with check (
    exists (
      select 1 from public.itps i
      join public.projects p on p.id = i.project_id
      where i.id = itp_revisions.itp_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
  );
