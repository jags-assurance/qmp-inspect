-- Fixes a real RLS gap in 20260929050000_standalone_assignment_evidence_documents.sql: its write
-- policies checked is_jags_staff() alone, with no has_org_access()/has_project_access() scoping —
-- is_jags_staff() is a global "works at JAGS" flag (phase0_rls_policies.sql), not per-org
-- authorization, so any JAGS staff login (even one with zero access_grants for a given client org)
-- could insert/delete evidence-document links against ANY assignment_id in the system, including
-- organizations that staff member has no grant to and couldn't even SELECT (the sibling _select
-- policy correctly requires has_project_access). This also didn't actually match this table's own
-- sibling tables: standalone_assignment_measurements_write_i/u/d
-- (20260922000200_consolidate_permissive_policies_tier1.sql) check has_project_access(...) alone —
-- RLS enforces the tenant/project boundary, and "staff only" is left to the app layer
-- (session.isJagsStaff in lib/standalone/actions.ts, unchanged by this migration). Replacing the
-- write policies with that same has_project_access-only shape, consistent with every other child
-- table of standalone_assignments.
drop policy standalone_assignment_evidence_documents_write_i on public.standalone_assignment_evidence_documents;
drop policy standalone_assignment_evidence_documents_write_d on public.standalone_assignment_evidence_documents;

create policy standalone_assignment_evidence_documents_write_i on public.standalone_assignment_evidence_documents
  for insert with check (
    exists (
      select 1
      from standalone_assignments a
      join projects p on p.id = a.project_id
      where a.id = standalone_assignment_evidence_documents.assignment_id
        and has_project_access(p.id, p.organization_id)
    )
  );

create policy standalone_assignment_evidence_documents_write_d on public.standalone_assignment_evidence_documents
  for delete using (
    exists (
      select 1
      from standalone_assignments a
      join projects p on p.id = a.project_id
      where a.id = standalone_assignment_evidence_documents.assignment_id
        and has_project_access(p.id, p.organization_id)
    )
  );
