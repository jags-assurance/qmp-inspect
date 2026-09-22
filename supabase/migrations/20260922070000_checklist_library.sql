-- R44/R47: a real, standalone checklist/form template builder, separate from the two existing ways
-- a checklist_templates row gets created (1:1 auto-generation off an ITP activity, in
-- lib/checklists/actions.ts, and one item added at a time to an already-generated checklist).
--
-- Mirrors the itp_master_* two-tier pattern (20260910040000_phase3_master_itp_library.sql) exactly:
-- checklist_library_templates/checklist_library_items are Tier 1, JAGS-internal IP — a reusable
-- library of check-item sets, organised by discipline, never client-visible, staff-only at every
-- level (is_jags_staff()-gated `for all`, no has_org_access() branch anywhere). Tier 2 stays the
-- existing checklist_templates/checklist_items tables: "attaching" a library template to a specific
-- ITP activity (apps/web/lib/checklist-library/actions.ts) copies its items into a brand new,
-- real checklist_templates row scoped to that itp_item_id — a project-specific working copy with no
-- stored link back to the library, so a later library edit can never leak into an already-attached
-- checklist. The same library template can be attached to activities across many different clients'
-- ITPs, each attachment getting its own independent copy — that's what makes a single reusable
-- definition support per-client variants (each copy can then be hand-edited via the existing
-- addChecklistItemAction without touching the library original or any other project's copy).
--
-- checklist_items gains two nullable columns (acceptance_criteria, evidence_type) so a real,
-- project-scoped checklist item can carry the same structure as a library item — populated when a
-- checklist is attached from the library, left null for the pre-existing auto-generated path, which
-- has no equivalent data to carry over. Purely additive; no existing row or query is affected.
alter table public.checklist_items add column acceptance_criteria text;
alter table public.checklist_items add column evidence_type text;

create table public.checklist_library_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  discipline_id uuid references public.master_disciplines(id),
  description text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.checklist_library_items (
  id uuid primary key default gen_random_uuid(),
  library_template_id uuid not null references public.checklist_library_templates(id) on delete cascade,
  item_number text not null,
  description text not null,
  acceptance_criteria text,
  -- Free-text (e.g. "Photo", "Measurement", "Visual", "Document", "Signature") rather than a fixed
  -- enum — deliberately looser than itp_items.evidence_type's 1/2/3 CHECK, since this describes what
  -- evidence a single check item expects, a much more open-ended vocabulary than the three coarse
  -- ITP-activity-level evidence kinds.
  evidence_type text,
  is_mandatory boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (library_template_id, item_number)
);

create index checklist_library_items_template_id_idx on public.checklist_library_items (library_template_id);
create index checklist_library_templates_discipline_id_idx on public.checklist_library_templates (discipline_id);

create trigger checklist_library_templates_set_updated_at
  before update on public.checklist_library_templates
  for each row execute function public.set_updated_at();

alter table public.checklist_library_templates enable row level security;
alter table public.checklist_library_items enable row level security;

create policy checklist_library_templates_staff_all on public.checklist_library_templates
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

create policy checklist_library_items_staff_all on public.checklist_library_items
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());
