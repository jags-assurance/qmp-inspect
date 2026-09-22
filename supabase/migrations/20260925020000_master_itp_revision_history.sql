-- R31 (requirements audit): "Propose->review->approve/reject works end-to-end; no version-history
-- table -- only an incrementing integer, so a client can't browse prior master versions."
-- itp_master_templates.version has existed since phase3 (20260910040000) but every approved update
-- just delete-then-reinserts itp_master_sections/itp_master_items and bumps the integer -- the prior
-- content is gone with nothing left to browse.
--
-- Exact same pattern as itp_revisions (20260922020000_itp_revision_history.sql, R101), scoped to the
-- master library instead of a live project ITP: itp_master_revisions freezes what a master template
-- looked like AT a given version number, at the moment it was superseded -- the live
-- itp_master_templates/itp_master_sections/itp_master_items tables always hold the CURRENT (highest)
-- version's content. Version 1's snapshot is written the moment a new_template proposal is approved
-- (see lib/itp-master/revisions.ts:snapshotInitialVersion); each subsequent update_existing approval
-- snapshots the pre-update state before bumping itp_master_templates.version
-- (lib/itp-master/revisions.ts:snapshotBeforeUpdate).

create table public.itp_master_revisions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.itp_master_templates (id) on delete cascade,
  version int not null,
  title text not null,
  industry text not null,
  applicable_standard text,
  -- Frozen array of {section_number, title, sort_order, items: [...]} -- a plain JSON snapshot
  -- rather than a parallel set of historical rows, mirroring itp_revisions.sections_snapshot: a
  -- point-in-time record never queried relationally, only rendered back as-is.
  sections_snapshot jsonb not null,
  reason text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

create index itp_master_revisions_template_id_idx on public.itp_master_revisions (template_id);

alter table public.itp_master_revisions enable row level security;

-- Staff-only for both read and insert-only write, matching every other itp_master_* table
-- (20260910040000) -- this is Tier 1 JAGS-internal IP and never client-visible. Insert-only from
-- here (a version snapshot is never edited or deleted once written), same as itp_revisions.
create policy itp_master_revisions_staff_select on public.itp_master_revisions
  for select using (public.is_jags_staff());

create policy itp_master_revisions_staff_insert on public.itp_master_revisions
  for insert
  with check (public.is_jags_staff());
