-- R79 extension: a project-wide, ORDERED, multi-person ITP review chain — a real, richer feature
-- than the existing itp_approval_workflow_configs (one org-wide optional reviewer + one approver).
-- itp_review_chain_members is the reusable, project-level configuration (who, in what order);
-- itp_review_progress is a per-ITP SNAPSHOT of that chain taken at "Submit for review" time, so a
-- later change to the project's chain never retroactively changes an ITP already mid-review — same
-- snapshot principle activity_signoff_progress already uses for the H/W/R/S grid.

create table public.itp_review_chain_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  reviewer_user_id uuid not null references public.users (id),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, reviewer_user_id)
);

create index itp_review_chain_members_project_id_idx on public.itp_review_chain_members (project_id);

create table public.itp_review_progress (
  id uuid primary key default gen_random_uuid(),
  itp_id uuid not null references public.itps (id) on delete cascade,
  reviewer_user_id uuid not null references public.users (id),
  sort_order int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (itp_id, reviewer_user_id)
);

create index itp_review_progress_itp_id_idx on public.itp_review_progress (itp_id);

alter table public.itp_review_chain_members enable row level security;
alter table public.itp_review_progress enable row level security;

-- Chain config: visible to anyone with project access; writable by staff only (an Admin sets up who
-- reviews a project's ITPs, same authority level as other project-config toggles).
create policy itp_review_chain_members_select on public.itp_review_chain_members
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = itp_review_chain_members.project_id
        and public.has_project_access(p.id, p.organization_id)
    )
  );

create policy itp_review_chain_members_write on public.itp_review_chain_members
  for all using (
    public.is_jags_staff()
    and exists (
      select 1 from public.projects p
      where p.id = itp_review_chain_members.project_id
        and public.has_project_access(p.id, p.organization_id)
    )
  ) with check (
    public.is_jags_staff()
    and exists (
      select 1 from public.projects p
      where p.id = itp_review_chain_members.project_id
        and public.has_project_access(p.id, p.organization_id)
    )
  );

-- Progress rows: visible to anyone with access to the parent ITP's project. Writable by staff
-- (creating the snapshot, auto-approving the ITP) or by the specific reviewer approving their own
-- row — the app layer double-checks "is it actually their turn" beyond what RLS alone expresses.
create policy itp_review_progress_select on public.itp_review_progress
  for select using (
    exists (
      select 1 from public.itps i join public.projects p on p.id = i.project_id
      where i.id = itp_review_progress.itp_id
        and public.has_project_access(p.id, p.organization_id)
    )
  );

create policy itp_review_progress_insert on public.itp_review_progress
  for insert with check (public.is_jags_staff());

create policy itp_review_progress_update on public.itp_review_progress
  for update using (
    public.is_jags_staff() or reviewer_user_id = auth.uid()
  ) with check (
    public.is_jags_staff() or reviewer_user_id = auth.uid()
  );
