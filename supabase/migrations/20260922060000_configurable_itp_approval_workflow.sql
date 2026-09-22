-- R79: configurable ITP approval workflow. Today, ITP review (draft -> under_review) and approval
-- (under_review -> approved) in advanceItpStatusAction is open to "any JAGS staff" — there's no way
-- for an organisation to say "only this specific person may review" / "only this specific person
-- may approve". This adds an optional, org-scoped config an Admin can set; leaving a slot unset
-- keeps today's unrestricted behaviour exactly as-is (no regression for orgs that never configure
-- this), matching this app's existing "additive, opt-in" pattern for org settings (compare
-- intervention_level_types / numbering_configs / organization_plans, all additive to prior
-- behaviour).
--
-- One row per organisation (not per-project) — the task explicitly asks to keep this simple, same
-- granularity as organization_plans (20260917070000_org_plans_and_seat_limit.sql). Unlike that
-- table, there's no "every org needs a default row" trigger here: a missing row IS the meaningful
-- default state (unrestricted), so this is left MISSING rather than seeded with nulls — the app
-- reads "no row" as "no restriction" everywhere it checks this table.
create table public.itp_approval_workflow_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  -- null = "any JAGS staff with org access can review/approve" (today's behaviour). Non-null pins
  -- that step to one specific user; is_admin_staff() can always override, matching this app's
  -- existing "Admin can do anything a more specific role can" convention (see e.g.
  -- isAdminStaff()'s own doc comment in lib/auth/session.ts).
  required_reviewer_user_id uuid references public.users (id),
  required_approver_user_id uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger itp_approval_workflow_configs_set_updated_at
  before update on public.itp_approval_workflow_configs
  for each row execute function public.set_updated_at();

alter table public.itp_approval_workflow_configs enable row level security;

-- Read access to any party with org access (needed just to render "who is required" messaging to a
-- non-admin staff member who hits the restriction) — mirrors organization_plans_select /
-- intervention_level_types_select exactly.
create policy itp_approval_workflow_configs_select on public.itp_approval_workflow_configs
  for select using (public.has_org_access(organization_id));

-- Configuring who reviews/approves is an administrative act, same boundary as numbering and
-- intervention levels — gated to JAGS Admin, and (as with intervention_level_types_admin_write)
-- also requires org access so an Admin can't blindly write rows for an org they have no grant to.
create policy itp_approval_workflow_configs_admin_write on public.itp_approval_workflow_configs
  for all
  using (public.is_jags_staff() and public.has_org_access(organization_id))
  with check (public.is_jags_staff() and public.has_org_access(organization_id));

-- R80: external approval reference — lets staff record that a client approved an ITP in their OWN
-- external system (e.g. a document-control platform like Aconex) instead of clicking Accept in this
-- app. Purely additive columns on the existing itps table, same shape as the reviewed_by/reviewed_at
-- and approved_by/approved_at pairs already on this table.
alter table public.itps
  add column external_approval_reference text,
  add column external_approval_recorded_by uuid references public.users (id),
  add column external_approval_recorded_at timestamptz;
