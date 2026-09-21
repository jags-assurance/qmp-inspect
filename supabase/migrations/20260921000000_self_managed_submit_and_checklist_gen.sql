-- Reduces JAGS-staff touchpoints on a Self-Managed client's own ITP lifecycle, without touching
-- the one action this session's earlier design explicitly reserved to JAGS: Approving an ITP
-- (draft -> under_review -> approved is unilateral JAGS, on purpose — independent assurance can't
-- self-certify). What this migration DOES open up, because neither one is a certification act:
--
-- 1. "Submit for review" (draft -> under_review): the same party who is already allowed to build
--    the whole draft (is_client_itp_creator, 20260918000000_client_itp_creation.sql) can now also
--    hand it to JAGS themselves, instead of asking a JAGS contact to click the button for them.
--    JAGS still has to Approve — this only removes a purely clerical hop before that.
-- 2. "Generate checklists" (the manual button, only usable once an ITP is 'approved'): the same
--    eligible party can now trigger this themselves too. It creates checklist_templates/items
--    scaffolding from activities that already exist and were already approved — it doesn't alter
--    ITP content and doesn't certify anything, so there's no integrity reason to keep it staff-only.

-- New function rather than widening is_client_itp_creator's own contract (which several existing
-- policies rely on meaning "draft only") — this one explicitly also allows 'approved'.
create or replace function public.is_client_checklist_generator(target_project_id uuid, itp_status text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    itp_status in ('draft', 'approved')
    and exists (
      select 1 from public.projects p
      join public.organizations o on o.id = p.organization_id
      join public.project_parties pp on pp.project_id = p.id
      where p.id = target_project_id
        and pp.is_active
        and pp.user_id = auth.uid()
        and (
          (pp.party_type = 'client' and (p.allow_client_itp_creation or o.engagement_scope = 'self_managed'))
          or (pp.party_type in ('subcontractor', 'main_contractor') and p.allow_contractor_itp_creation)
        )
    );
$$;

grant execute on function public.is_client_checklist_generator(uuid, text) to authenticated;

-- Additive (OR'd) permissive policy alongside the existing itps_write — only ever matches the
-- single draft -> under_review transition: "using" requires the CURRENT row to still be draft,
-- "with check" requires the NEW row to be exactly under_review. is_client_itp_creator is called
-- with the literal 'draft' in both clauses purely to reuse its party-eligibility check; it is not
-- being asked to validate a status value here, since the surrounding clauses already do that more
-- narrowly than is_client_itp_creator's own itp_status param would.
create policy itps_client_submit_for_review on public.itps
  for update
  using (
    status = 'draft'
    and public.is_client_itp_creator(project_id, 'draft')
  )
  with check (
    status = 'under_review'
    and public.is_client_itp_creator(project_id, 'draft')
  );

-- Checklist generation only ever INSERTs new template/item rows (generateChecklistsForItp) — an
-- insert-only policy is enough, and keeps the existing draft-only checklist_templates_write /
-- checklist_items_write policies (content editing) unchanged.
create policy checklist_templates_client_generate on public.checklist_templates
  for insert
  with check (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = checklist_templates.itp_item_id
        and public.is_client_checklist_generator(p.id, i.status)
    )
  );

create policy checklist_items_client_generate on public.checklist_items
  for insert
  with check (
    exists (
      select 1 from public.checklist_templates t
      join public.itp_items it on it.id = t.itp_item_id
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where t.id = checklist_items.template_id
        and public.is_client_checklist_generator(p.id, i.status)
    )
  );
