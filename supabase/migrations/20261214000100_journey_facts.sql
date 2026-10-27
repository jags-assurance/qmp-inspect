-- One call for the Workflow page's progress counts, instead of about 25 separate count queries per load.
-- SECURITY INVOKER: every count runs as the signed-in user, so row-level security decides what is counted,
-- exactly as the separate queries did. The page falls back to the separate queries if this function is absent.
create or replace function public.journey_facts(p_org_id uuid, p_project_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'numbering', (select count(*) from numbering_configs where organization_id = p_org_id),
    'teams', (select count(*) from teams),
    'parties', (select count(*) from project_parties where project_id = p_project_id),
    'parties_no_login', (select count(*) from project_parties where project_id = p_project_id and user_id is null),
    'vault', (select count(*) from vault_documents d join vault_folders f on f.id = d.folder_id where f.project_id = p_project_id),
    'calibration', (select count(*) from calibration_register where project_id = p_project_id),
    'material', (select count(*) from material_register where project_id = p_project_id),
    'welder', (select count(*) from welder_qualification_register where project_id = p_project_id),
    'personnel', (select count(*) from personnel_certifications where project_id = p_project_id),
    'itps', (select count(*) from itps where project_id = p_project_id),
    'itps_approved', (select count(*) from itps where project_id = p_project_id and status in ('approved', 'client_accepted')),
    'itps_draft', (select count(*) from itps where project_id = p_project_id and status = 'draft'),
    'itps_awaiting_client', (select count(*) from itps where project_id = p_project_id and status = 'approved'),
    'activities', (select count(*) from itp_items i join itp_sections s on s.id = i.section_id join itps t on t.id = s.itp_id where t.project_id = p_project_id),
    'inspections_done', (select count(*) from inspection_records where project_id = p_project_id and overall_result is not null),
    'inspections_pass', (select count(*) from inspection_records where project_id = p_project_id and overall_result = 'pass'),
    'inspections_open', (select count(*) from inspection_records where project_id = p_project_id and overall_result is null),
    'ncrs_open', (select count(*) from ncrs where project_id = p_project_id and status <> 'closed'),
    'punch_open', (select count(*) from punch_list_items where project_id = p_project_id and status = 'open'),
    'irns', (select count(*) from irns r join inspection_records x on x.id = r.inspection_record_id where x.project_id = p_project_id),
    'checklists', (select count(*) from checklist_templates c join itp_items i on i.id = c.itp_item_id join itp_sections s on s.id = i.section_id join itps t on t.id = s.itp_id where t.project_id = p_project_id),
    'signoff_total', (select count(*) from activity_signoff_progress a join itp_items i on i.id = a.itp_item_id join itp_sections s on s.id = i.section_id join itps t on t.id = s.itp_id where t.project_id = p_project_id),
    'signoff_open', (select count(*) from activity_signoff_progress a join itp_items i on i.id = a.itp_item_id join itp_sections s on s.id = i.section_id join itps t on t.id = s.itp_id where t.project_id = p_project_id and a.status in ('pending', 'notified'))
  );
$$;

grant execute on function public.journey_facts(uuid, uuid) to authenticated;
