-- Unindexed foreign keys flagged by the performance advisor.
create index if not exists checklist_responses_updated_by_idx on public.checklist_responses (updated_by);
create index if not exists inspection_record_amendments_amended_by_idx on public.inspection_record_amendments (amended_by);
create index if not exists irns_voided_by_idx on public.irns (voided_by);
create index if not exists ncr_documents_linked_by_idx on public.ncr_documents (linked_by);
create index if not exists ncr_documents_vault_document_id_idx on public.ncr_documents (vault_document_id);

-- Multiple permissive policies: the ALL write policy already covers SELECT with the same predicate.
drop policy if exists ncr_documents_select on public.ncr_documents;

-- itp_master_item_interventions: select (staff) + ALL (admin) overlap on SELECT; split writes per command.
drop policy if exists itp_master_item_interventions_write on public.itp_master_item_interventions;
drop policy if exists itp_master_item_interventions_write_i on public.itp_master_item_interventions;
drop policy if exists itp_master_item_interventions_write_u on public.itp_master_item_interventions;
drop policy if exists itp_master_item_interventions_write_d on public.itp_master_item_interventions;
create policy itp_master_item_interventions_write_i on public.itp_master_item_interventions
  for insert with check ((select public.is_admin_staff()));
create policy itp_master_item_interventions_write_u on public.itp_master_item_interventions
  for update using ((select public.is_admin_staff())) with check ((select public.is_admin_staff()));
create policy itp_master_item_interventions_write_d on public.itp_master_item_interventions
  for delete using ((select public.is_admin_staff()));
