-- Two fixes from a final adversarial QA pass on the ITP evidence-execution flows
-- (evidence_type=2/3, added in 20260929040000_itp_item_evidence_execution.sql) and the original
-- checklist path.

-- 1. itp_item_measurements had select/insert/delete RLS policies but no update policy at all — a
--    measurement row entered with no result (or a typo in nominal/tolerance/actual/unit) could
--    never be corrected in place, only deleted and re-added, which loses recorded_by/created_at
--    provenance of the original entry. Same tenant/project-access boundary as the other three
--    policies on this table (has_project_access, or staff with org access) — the finer "only the
--    row's own recorder, or staff" rule stays at the app layer in
--    updateItpItemMeasurementAction (lib/itps/evidence-actions.ts), matching how delete on this
--    same table already works.
create policy itp_item_measurements_write_u on public.itp_item_measurements
  for update using (
    exists (
      select 1
      from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where it.id = itp_item_measurements.itp_item_id
        and (has_project_access(p.id, p.organization_id) or (is_jags_staff() and has_org_access(p.organization_id)))
    )
  )
  with check (
    exists (
      select 1
      from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where it.id = itp_item_measurements.itp_item_id
        and (has_project_access(p.id, p.organization_id) or (is_jags_staff() and has_org_access(p.organization_id)))
    )
  );

-- 2. startInspectionAction always inserts a new inspection_records row with no uniqueness guard —
--    two rapid "Start inspection" clicks (or a slow network causing a real double-submit) can
--    create two concurrent open drafts for the same checklist_template_id. The fill page only shows
--    the most-recently-created one, so the loser's already-saved responses become orphaned and
--    invisible from the normal UI. A partial unique index (only while overall_result is still null
--    — a checklist can have many *completed* inspection_records over time, just never two *open*
--    ones at once) closes this at the database layer, where a race condition actually has to be
--    closed rather than trying to catch it in application code.
create unique index inspection_records_one_open_draft_per_checklist
  on public.inspection_records (checklist_template_id)
  where overall_result is null;
