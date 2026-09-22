-- R102: a general, centralized audit trail. Before this, "who did what and when" was only ever
-- answerable per-entity (itps.approved_by/approved_at, ncrs.closed_by/closed_at, etc.) or, for AI
-- calls specifically, ai_usage_log — there was no single place to query every create/edit/approval/
-- status-change event across a project or organisation. This table is that place: one append-only
-- row per event, written by the server action that already performed the real mutation (see
-- apps/web/lib/audit/log.ts) — never a separate reconstruction of history after the fact.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Nullable: some events are org-level (e.g. a numbering/engagement setting change) rather than
  -- scoped to any one project.
  project_id uuid references public.projects (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  actor_id uuid references public.users (id),
  summary text not null,
  -- Optional structured detail (e.g. a before/after diff) — not every event needs one.
  changes jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_organization_id_idx on public.audit_log (organization_id);
create index audit_log_project_id_idx on public.audit_log (project_id);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

alter table public.audit_log enable row level security;

create policy audit_log_select on public.audit_log
  for select using (public.has_org_access(organization_id));

-- This codebase never uses a service-role client from app code (see
-- apps/web/lib/supabase/server.ts) — every insert happens through the acting user's own RLS-scoped
-- session, so the write policy is gated the same way every other insert in this schema is: org
-- access to the row's own organization_id.
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (public.has_org_access(organization_id));

-- Deliberately no update/delete policy: audit rows are append-only and never edited or deleted.
