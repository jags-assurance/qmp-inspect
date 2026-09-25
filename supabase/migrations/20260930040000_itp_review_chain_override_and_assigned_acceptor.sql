-- Two related asks, both "who specifically does this stage, in what order" gaps the round-table
-- flagged: (1) the existing itp_review_chain_members/itp_review_progress system (20260929010000)
-- only lets an Admin configure Approve's reviewer chain PER PROJECT (every ITP on that project
-- shares it) — this adds a per-ITP override layer on top, same precedence idea already used
-- elsewhere in this app (notice_period_configs project-override > org default); (2) "Accept" had no
-- assignment at all — any login linked to the project's client party could accept. Both stay
-- entirely optional: an ITP/project with nothing configured keeps today's exact behaviour.

-- Per-ITP override of the review chain — when a row exists for an itp_id, startReviewChainForItp
-- (lib/itps/review-chain.ts) snapshots THIS instead of the project's own itp_review_chain_members.
-- Same shape/semantics as that table, just keyed to one ITP instead of the whole project.
create table public.itp_review_chain_overrides (
  id uuid primary key default gen_random_uuid(),
  itp_id uuid not null references public.itps (id) on delete cascade,
  reviewer_user_id uuid not null references public.users (id),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (itp_id, reviewer_user_id)
);

create index itp_review_chain_overrides_itp_id_idx on public.itp_review_chain_overrides (itp_id);

alter table public.itp_review_chain_overrides enable row level security;

create policy itp_review_chain_overrides_select on public.itp_review_chain_overrides
  for select using (
    exists (
      select 1 from public.itps i join public.projects p on p.id = i.project_id
      where i.id = itp_review_chain_overrides.itp_id
        and public.has_project_access(p.id, p.organization_id)
    )
  );

-- Same authority as itp_review_chain_members_write (is_jags_staff, app layer narrows to Admin).
create policy itp_review_chain_overrides_write on public.itp_review_chain_overrides
  for all using (
    public.is_jags_staff()
    and exists (
      select 1 from public.itps i join public.projects p on p.id = i.project_id
      where i.id = itp_review_chain_overrides.itp_id
        and public.has_project_access(p.id, p.organization_id)
    )
  ) with check (
    public.is_jags_staff()
    and exists (
      select 1 from public.itps i join public.projects p on p.id = i.project_id
      where i.id = itp_review_chain_overrides.itp_id
        and public.has_project_access(p.id, p.organization_id)
    )
  );

-- Single assigned acceptor (Reqs the round-table asked for: "who will accept, decided by me,
-- assigned"). Null (the default) keeps today's behaviour — any login linked to the project's
-- client party can accept. When set, accept_itp() below restricts acceptance to that one login.
alter table public.itps add column assigned_acceptor_user_id uuid references public.users (id);

create or replace function public.accept_itp(target_itp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  itp_org uuid;
  itp_project uuid;
  assigned_acceptor uuid;
  is_linked_client boolean;
begin
  select o.id, p.id, i.assigned_acceptor_user_id into itp_org, itp_project, assigned_acceptor
  from public.itps i
  join public.projects p on p.id = i.project_id
  join public.organizations o on o.id = p.organization_id
  where i.id = target_itp_id;

  if itp_org is null then
    raise exception 'ITP not found';
  end if;

  if not public.has_org_access(itp_org) then
    raise exception 'Not authorized for this organisation';
  end if;

  if assigned_acceptor is not null then
    if auth.uid() != assigned_acceptor then
      raise exception 'Only this ITP''s assigned acceptor can accept it';
    end if;
  else
    select exists (
      select 1 from public.project_parties
      where project_id = itp_project
        and party_type = 'client'
        and user_id = auth.uid()
    ) into is_linked_client;

    if not is_linked_client then
      raise exception 'Only the client party''s own login can accept this ITP';
    end if;
  end if;

  update public.itps
  set status = 'client_accepted', client_accepted_by = auth.uid(), client_accepted_at = now()
  where id = target_itp_id and status = 'approved';

  if not found then
    raise exception 'ITP must be approved before it can be accepted';
  end if;
end;
$$;
