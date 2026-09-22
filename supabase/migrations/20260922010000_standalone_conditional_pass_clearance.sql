-- R16: "conditional pass with punch list — the assignment stays open until listed items are
-- cleared, then a clearance/close-out is issued." Previously finalizing with conditional_pass set
-- status = 'completed' immediately, identically to a clean pass — nothing stayed open, and no
-- clearance/close-out concept existed. Adds a genuine intermediate state plus the columns needed to
-- record who issued clearance and when.

alter table public.standalone_assignments
  drop constraint standalone_assignments_status_check;

alter table public.standalone_assignments
  add constraint standalone_assignments_status_check
  check (status in ('draft', 'conditional_open', 'completed'));

alter table public.standalone_assignments
  add column cleared_by uuid references public.users (id),
  add column cleared_at timestamptz;
