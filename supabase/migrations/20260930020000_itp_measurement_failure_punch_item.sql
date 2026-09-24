-- Closes a real gap from the final QA pass: a failed ITP measurement-record row (evidence_type=3)
-- never fed the project-wide punch list, unlike a failed checklist inspection (R92-R96) —
-- inconsistent between the two evidence types with no reason for the difference. This gives
-- measurement-record activities the same "a failure automatically lands on the punch list" behavior
-- checklists already have.

alter table public.punch_list_items
  drop constraint punch_list_items_source_check;

alter table public.punch_list_items
  add constraint punch_list_items_source_check
  check (source in ('inspection_failure', 'fat_conditional_pass', 'ncr', 'walkdown', 'manual', 'itp_measurement_failure'));

-- Same shape as source_inspection_record_id/source_standalone_assignment_id/source_ncr_id above it
-- — lets a punch item created from a failed measurement link back to the specific ITP activity it
-- came from.
alter table public.punch_list_items
  add column source_itp_item_id uuid references public.itp_items (id);
