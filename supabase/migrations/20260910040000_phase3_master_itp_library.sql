-- Phase 3: two-tier master/client ITP template library (Reqs R31).
--
-- Tier 1 (this file's tables) is JAGS-internal IP: a library of master ITP templates built up
-- across projects, organised by industry/discipline. It is never client-visible, at every level —
-- every table below is staff-only for both read and write (is_jags_staff()-gated `for all`), unlike
-- the has_org_access()-gated tables in 20260909230000_phase1_itp_core.sql. That's deliberate: this
-- is the whole point of Tier 1 not leaking to clients, so no has_org_access() policy appears here
-- even though itp_master_proposals.source_itp_id points at a client's real ITP.
--
-- Tier 2 is just the existing itps/itp_sections/itp_items tables (phase1_itp_core): starting an ITP
-- "from a template" copies master rows into a normal project ITP with no stored link back, so it
-- becomes that project's own independent, editable copy and can never leak edits into the master.

create table public.itp_master_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  industry text not null,
  discipline_id uuid references public.master_disciplines(id),
  applicable_standard text,
  version int not null default 1,
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.itp_master_sections (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.itp_master_templates(id) on delete cascade,
  section_number int not null,
  title text not null,
  sort_order int not null default 0,
  unique(template_id, section_number)
);

create table public.itp_master_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.itp_master_sections(id) on delete cascade,
  item_number text not null,
  activity text not null,
  reference_spec text,
  acceptance_criteria text,
  method text,
  frequency text,
  evidence_type int not null default 1 check (evidence_type in (1,2,3)),
  sort_order int not null default 0
);

create index itp_master_sections_template_id_idx on public.itp_master_sections (template_id);
create index itp_master_items_section_id_idx on public.itp_master_items (section_id);

-- One row per project-derived ITP that's been proposed back to the master library, tracked through
-- its own review lifecycle — separate from the live ITP's own status (draft/under_review/approved/
-- client_accepted), since a proposal can be pending long after the originating ITP is already
-- client_accepted and in use on its project.
create table public.itp_master_proposals (
  id uuid primary key default gen_random_uuid(),
  source_itp_id uuid not null references public.itps(id) on delete cascade,
  proposed_action text not null check (proposed_action in ('new_template','update_existing')),
  target_template_id uuid references public.itp_master_templates(id),  -- set when proposed_action = 'update_existing'
  proposed_title text,
  proposal_notes text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  proposed_by uuid references public.users(id),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now()
);

create index itp_master_proposals_status_idx on public.itp_master_proposals (status);

create trigger itp_master_templates_set_updated_at
  before update on public.itp_master_templates
  for each row execute function public.set_updated_at();

alter table public.itp_master_templates enable row level security;
alter table public.itp_master_sections enable row level security;
alter table public.itp_master_items enable row level security;
alter table public.itp_master_proposals enable row level security;

-- Staff-only for both read and write, on all four tables — no has_org_access() branch anywhere
-- here, including on itp_master_proposals, even though its source_itp_id references a row a
-- client can see. The proposal record and anything it creates/updates in the master library stay
-- internal regardless of who can see the originating ITP.
create policy itp_master_templates_staff_all on public.itp_master_templates
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

create policy itp_master_sections_staff_all on public.itp_master_sections
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

create policy itp_master_items_staff_all on public.itp_master_items
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

create policy itp_master_proposals_staff_all on public.itp_master_proposals
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());
