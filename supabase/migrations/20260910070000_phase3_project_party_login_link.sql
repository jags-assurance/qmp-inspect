-- Phase 3: link a project_parties row to the actual logged-in user who represents that party, so
-- role-based access can be enforced for real instead of only modeled as data.
--
-- Until now, project_parties was purely descriptive (e.g. "Voltway Electrical Ltd" as a named
-- subcontractor) with no connection to who actually logs in as them — which meant any user with
-- project access could Notify/Sign-off on ANY party's intervention row, not just their own. That's
-- wrong: in the real workflow, a subcontractor signs off their own Witness/Hold point, not GFL's or
-- Bureau Veritas's. This column is the missing link that makes that restriction enforceable.
--
-- Nullable: a party can exist in the ITP grid before anyone has actually logged in to represent
-- them (e.g. JAGS sets up the project party list before inviting the subcontractor's user), and
-- JAGS staff can always act on any party's behalf regardless of this link (see the updated RLS/
-- action-level checks in lib/signoff/actions.ts).
alter table public.project_parties
  add column user_id uuid references public.users (id);

create index project_parties_user_id_idx on public.project_parties (user_id);
