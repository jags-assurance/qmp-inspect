-- Performance pass driven by Supabase's own advisor (performance lints), no behaviour change.

-- 1) auth_rls_initplan: auth.uid() inside a policy is re-evaluated per row unless wrapped in a
--    scalar subselect. Same predicate, evaluated once per statement instead.
drop policy if exists itp_review_progress_update on public.itp_review_progress;
create policy itp_review_progress_update on public.itp_review_progress
  for update
  using (is_jags_staff() or reviewer_user_id = (select auth.uid()))
  with check (is_jags_staff() or reviewer_user_id = (select auth.uid()));

drop policy if exists vault_document_approvers_update on public.vault_document_approvers;
create policy vault_document_approvers_update on public.vault_document_approvers
  for update
  using (is_jags_staff() or approver_user_id = (select auth.uid()))
  with check (is_jags_staff() or approver_user_id = (select auth.uid()));

-- 2) unindexed_foreign_keys: every FK the advisor listed, so cascade deletes and joins on the
--    referenced side stop sequentially scanning.
create index if not exists inspection_evidence_documents_checklist_item_idx on public.inspection_evidence_documents (checklist_item_id);
create index if not exists inspection_evidence_documents_linked_by_idx on public.inspection_evidence_documents (linked_by);
create index if not exists inspection_evidence_documents_vault_document_idx on public.inspection_evidence_documents (vault_document_id);
create index if not exists itp_item_evidence_documents_linked_by_idx on public.itp_item_evidence_documents (linked_by);
create index if not exists itp_item_evidence_documents_vault_document_idx on public.itp_item_evidence_documents (vault_document_id);
create index if not exists itp_item_measurements_recorded_by_idx on public.itp_item_measurements (recorded_by);
create index if not exists itp_review_chain_members_reviewer_idx on public.itp_review_chain_members (reviewer_user_id);
create index if not exists itp_review_chain_overrides_reviewer_idx on public.itp_review_chain_overrides (reviewer_user_id);
create index if not exists itp_review_progress_reviewer_idx on public.itp_review_progress (reviewer_user_id);
create index if not exists itps_assigned_acceptor_idx on public.itps (assigned_acceptor_user_id);
create index if not exists project_party_members_custom_role_idx on public.project_party_members (custom_role_id);
create index if not exists project_party_members_granted_by_idx on public.project_party_members (granted_by);
create index if not exists punch_list_items_resolved_by_idx on public.punch_list_items (resolved_by);
create index if not exists punch_list_items_source_itp_item_idx on public.punch_list_items (source_itp_item_id);
create index if not exists standalone_assignment_evidence_documents_linked_by_idx on public.standalone_assignment_evidence_documents (linked_by);
create index if not exists standalone_assignment_evidence_documents_vault_document_idx on public.standalone_assignment_evidence_documents (vault_document_id);
create index if not exists vault_document_approvers_approver_idx on public.vault_document_approvers (approver_user_id);
