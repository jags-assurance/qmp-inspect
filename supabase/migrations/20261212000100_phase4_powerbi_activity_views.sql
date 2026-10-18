-- Phase 4: Power BI views covering the app's day-to-day activity (R110 follow-up).
-- Client requirement: everything that happens in the app should be reportable in Power BI. The
-- existing views (20260910120000, 20260915040000) are per-project roll-ups; these four add the
-- row-level / activity-level detail needed to slice by activity, attempt, party and project:
--   7. vw_powerbi_inspection_attempts      one row per inspection_records row
--   8. vw_powerbi_signoff_turnaround       one row per activity_signoff_progress row
--   9. vw_powerbi_databook_completeness    one row per project (readiness figures)
--  10. vw_powerbi_activity_fact            one row per itp_items row (flat fact table)
--
-- SECURITY — identical to the existing vw_powerbi_* views, deliberately:
--   * plain views (NOT security_invoker). The existing views are not security_invoker either, and
--     must not be: powerbi_reader is a plain Postgres login with no Supabase Auth session, so
--     has_org_access() / auth.uid() are null for it and every RLS policy on the base tables would
--     return zero rows. The views therefore read the base tables with the view owner's rights.
--   * isolation is by WHO CAN CONNECT: SELECT is granted to powerbi_reader only (JAGS-internal
--     staff). organization_id and project_id are plain columns on every view so Power BI can slice
--     by tenant itself.
--   * because these views bypass RLS, they MUST NOT be readable by anon/authenticated (the
--     PostgREST roles): see 20260916140000_grant_powerbi_views_to_authenticated.sql for the
--     cross-tenant leak that a blanket grant caused. Supabase's default privileges on new public
--     objects may grant anon/authenticated, so the explicit REVOKE at the bottom is mandatory.
--   * read-only: views over SELECTs only; no function, no write path, no new table.
--
-- Every view reads base tables only (never another vw_powerbi_* view) so each can be dropped or
-- changed independently.

-- --------------------------------------------------------------------------------------------
-- 7. Inspection attempts — one row per inspection_records row.
--    revision = per-activity attempt counter at creation (0 = first attempt "A", 1 = "B", ...,
--    see 20260930110000). attempt_sequence is an independent 1-based ordering by created_at so
--    the figure stays usable if a revision value was ever missing/duplicated.
--    A failed attempt is "later passed" when a LATER record on the same itp_item has
--    overall_result = 'pass' (strict 'pass'; 'partial' is not treated as a pass here, unlike the
--    Data Book readiness rule, so the metric answers "how long until it actually passed").
--    days_to_pass = days from the failed attempt's created_at to the first later passing record's
--    created_at. Draft/in-progress records (overall_result null) are included with
--    is_completed = false so Power BI can filter them out.
-- --------------------------------------------------------------------------------------------
create or replace view public.vw_powerbi_inspection_attempts as
select
  p.organization_id,
  p.id as project_id,
  p.project_number,
  p.name as project_name,
  i.id as itp_id,
  i.itp_number,
  i.title as itp_title,
  ii.id as itp_item_id,
  ii.item_number,
  ii.activity,
  ir.id as inspection_record_id,
  ir.record_number,
  ir.revision,
  case when ir.revision between 0 and 25 then chr(65 + ir.revision) else ir.revision::text end as attempt_label,
  row_number() over (partition by ir.itp_item_id order by ir.created_at, ir.id) as attempt_sequence,
  ir.overall_result,
  (ir.overall_result is not null) as is_completed,
  ir.inspector_id,
  u.full_name as inspector_name,
  ir.inspection_date,
  ir.created_at as created_at,
  (ir.revision > 0) as is_reinspection,
  (ir.overall_result = 'fail') as is_failed_attempt,
  exists (
    select 1 from public.irns n
    where n.inspection_record_id = ir.id and n.voided_at is null
  ) as has_issued_irn,
  (ir.overall_result = 'fail' and later_pass.passed_at is not null) as failed_then_passed,
  case when ir.overall_result = 'fail' then later_pass.passed_at end as later_passed_at,
  case
    when ir.overall_result = 'fail' and later_pass.passed_at is not null
      then round(extract(epoch from (later_pass.passed_at - ir.created_at)) / 86400.0, 2)
  end as days_to_pass
from public.inspection_records ir
join public.itp_items ii on ii.id = ir.itp_item_id
join public.itp_sections s on s.id = ii.section_id
join public.itps i on i.id = s.itp_id
join public.projects p on p.id = ir.project_id
left join public.users u on u.id = ir.inspector_id
left join lateral (
  select min(l.created_at) as passed_at
  from public.inspection_records l
  where l.itp_item_id = ir.itp_item_id
    and l.overall_result = 'pass'
    and (l.created_at, l.id) > (ir.created_at, ir.id)
) later_pass on true;

comment on view public.vw_powerbi_inspection_attempts is
  'Power BI (R110, phase 4): one row per inspection record (attempt) with project/ITP/activity, revision (0=A,1=B), result, inspector, date, is_reinspection, and for failed attempts whether/when a later attempt passed (days_to_pass). New analytics, not a mirror of compute.ts.';

-- --------------------------------------------------------------------------------------------
-- 8. Sign-off turnaround — one row per activity_signoff_progress row (one per activity x party
--    that has an intervention level).
--    signed_off and proceeded_no_response are kept DISTINCT on purpose (same as the app and the
--    Data Book rule): hours_to_signoff is only set for status = 'signed_off'; hours_to_proceed is
--    only set for status = 'proceeded_no_response' (notified_at -> proceeded_at). Never blend them
--    into one "response time". Rows never notified have null hours. Open (pending/notified) rows
--    are included with hours_waiting_open for ageing charts (measured to now() at query time).
--    notice_period_hours = the project's configured notice period for H/W, else the app fallback
--    (Hold 48h, Witness 24h) — R/S levels have none (null).
-- --------------------------------------------------------------------------------------------
create or replace view public.vw_powerbi_signoff_turnaround as
select
  p.organization_id,
  p.id as project_id,
  p.project_number,
  p.name as project_name,
  i.id as itp_id,
  i.itp_number,
  ii.id as itp_item_id,
  ii.item_number,
  ii.activity,
  asp.id as signoff_progress_id,
  asp.project_party_id,
  pp.name as party_name,
  pp.party_type,
  asp.intervention,
  case asp.intervention
    when 'H' then 'Hold'
    when 'W' then 'Witness'
    when 'R' then 'Review'
    when 'S' then 'Surveillance'
  end as intervention_label,
  asp.status,
  asp.notified_at,
  asp.signed_off_at,
  asp.proceeded_at,
  case when asp.status = 'signed_off' then asp.signed_off_at end as responded_at,
  case
    when asp.status = 'signed_off' and asp.notified_at is not null and asp.signed_off_at is not null
      then round(extract(epoch from (asp.signed_off_at - asp.notified_at)) / 3600.0, 2)
  end as hours_to_signoff,
  case
    when asp.status = 'proceeded_no_response' and asp.notified_at is not null and asp.proceeded_at is not null
      then round(extract(epoch from (asp.proceeded_at - asp.notified_at)) / 3600.0, 2)
  end as hours_to_proceed,
  case
    when asp.status = 'notified' and asp.notified_at is not null
      then round(extract(epoch from (now() - asp.notified_at)) / 3600.0, 2)
  end as hours_waiting_open,
  case
    when asp.intervention in ('H', 'W')
      then coalesce(npc.hours, case asp.intervention when 'H' then 48 else 24 end)
  end as notice_period_hours,
  (asp.status = 'signed_off') as is_signed_off,
  (asp.status = 'proceeded_no_response') as is_proceeded_no_response
from public.activity_signoff_progress asp
join public.itp_items ii on ii.id = asp.itp_item_id
join public.itp_sections s on s.id = ii.section_id
join public.itps i on i.id = s.itp_id
join public.projects p on p.id = i.project_id
left join public.project_parties pp on pp.id = asp.project_party_id
left join public.notice_period_configs npc
  on npc.project_id = p.id and npc.intervention = asp.intervention;

comment on view public.vw_powerbi_signoff_turnaround is
  'Power BI (R110, phase 4): one row per activity x party sign-off with intervention level, party, notified/signed-off/proceeded timestamps and hours to respond. signed_off and proceeded_no_response are kept distinct (hours_to_signoff vs hours_to_proceed).';

-- --------------------------------------------------------------------------------------------
-- 9. Data Book completeness — one row per project. Mirrors computeDataBookReadiness() in
--    apps/web/lib/databook/readiness.ts (+ strictPercentage in readiness-math.ts): per category
--    <x>_ready / <x>_total, the gating-category overall percentage (sum ready / sum total,
--    floored, 99 max unless everything is ready, 100 when nothing is required) and is_ready.
--    Evaluated live at query time (not stored), like the app.
--    Rules mirrored:
--      itps          live ITPs (not superseded/withdrawn); ready = approved|client_accepted and not
--                    revision_needs_approval
--      inspection_records  latest COMPLETED record per activity, only when pass/partial; ready when
--                    it has a non-voided IRN
--      checklists    checklist templates of evidence_type=1 activities on approved/client_accepted
--                    ITPs; ready when a completed record exists for that template
--      calibration/welder/personnel registers  counted rows only (verified_at not null and
--                    lifecycle_status active); ready = date not in the past (UTC date)
--      material      counted rows; ready = approval A|B and receipt released
--      standalone    ready = completed and (pass | conditional_pass with cleared_at)
--      ncrs          excluding severity 'observation'; ready = closed
--      activities    evidence_type=1 activities on approved/client_accepted ITPs; ready when the
--                    latest completed inspection is pass/partial
--      hold_points   H/W sign-offs on activities of approved/client_accepted ITPs; ready =
--                    signed_off, or Witness proceeded_no_response
--    open_punch_items and handover_certificate_issued are exposed as in the app: open punch items
--    must be 0 for is_ready; the handover certificate is informational and NOT in the overall
--    percentage or is_ready.
--    NOT expressible / differences (document in docs/POWERBI_VIEWS.md):
--      * the per-category percentage is not a column — compute ready/total in Power BI (apply the
--        same strict rule: 100 if total=0 or ready>=total, else min(99, floor(100*ready/total))).
--      * calibration/welder/personnel "expired" uses the Postgres UTC date at query time, same
--        intent as todayUtc() in lib/registers/status.ts; a Power BI Import snapshot freezes it.
--      * the app reads some tables with tolerance for missing columns on un-migrated databases;
--        this view requires the current schema (verified_at / lifecycle_status exist).
--      * the in-app overrides (override-items.ts, issued-book overrides) and the discipline
--        breakdown (discipline-breakdown.ts) are app-only and not reflected.
--      * the app tie-breaks equal created_at timestamps by read order; here by id.
-- --------------------------------------------------------------------------------------------
create or replace view public.vw_powerbi_databook_completeness as
with
  latest_rec as (
    select distinct on (ir.itp_item_id)
      ir.itp_item_id, ir.project_id, ir.id as record_id, ir.overall_result
    from public.inspection_records ir
    where ir.overall_result is not null
    order by ir.itp_item_id, ir.created_at desc, ir.id desc
  ),
  issued_items as (
    -- every activity on an approved / client-accepted ITP (the readiness "issued ITP" scope)
    select ii.id as itp_item_id, ii.evidence_type, i.project_id
    from public.itp_items ii
    join public.itp_sections s on s.id = ii.section_id
    join public.itps i on i.id = s.itp_id
    where i.status in ('approved', 'client_accepted')
  ),
  c_itps as (
    select i.project_id,
      count(*) as total,
      count(*) filter (
        where i.status in ('approved', 'client_accepted') and not coalesce(i.revision_needs_approval, false)
      ) as ready
    from public.itps i
    where i.status not in ('superseded', 'withdrawn')
    group by i.project_id
  ),
  c_records as (
    select lr.project_id,
      count(*) as total,
      count(*) filter (
        where exists (select 1 from public.irns n where n.inspection_record_id = lr.record_id and n.voided_at is null)
      ) as ready
    from latest_rec lr
    where lr.overall_result in ('pass', 'partial')
    group by lr.project_id
  ),
  c_checklists as (
    select ix.project_id,
      count(*) as total,
      count(*) filter (
        where exists (
          select 1 from public.inspection_records r
          where r.checklist_template_id = ct.id and r.overall_result is not null
        )
      ) as ready
    from public.checklist_templates ct
    join issued_items ix on ix.itp_item_id = ct.itp_item_id and ix.evidence_type = 1
    group by ix.project_id
  ),
  c_activities as (
    select ix.project_id,
      count(*) as total,
      count(*) filter (where lr.overall_result in ('pass', 'partial')) as ready
    from issued_items ix
    left join latest_rec lr on lr.itp_item_id = ix.itp_item_id
    where ix.evidence_type = 1
    group by ix.project_id
  ),
  c_holds as (
    select ix.project_id,
      count(*) as total,
      count(*) filter (
        where asp.status = 'signed_off' or (asp.intervention = 'W' and asp.status = 'proceeded_no_response')
      ) as ready
    from public.activity_signoff_progress asp
    join issued_items ix on ix.itp_item_id = asp.itp_item_id
    where asp.intervention in ('H', 'W')
    group by ix.project_id
  ),
  c_calibration as (
    select project_id, count(*) as total,
      count(*) filter (where due_date >= (now() at time zone 'utc')::date) as ready
    from public.calibration_register
    where verified_at is not null and coalesce(lifecycle_status, 'active') = 'active'
    group by project_id
  ),
  c_welder as (
    select project_id, count(*) as total,
      count(*) filter (where expiry_date >= (now() at time zone 'utc')::date) as ready
    from public.welder_qualification_register
    where verified_at is not null and coalesce(lifecycle_status, 'active') = 'active'
    group by project_id
  ),
  c_personnel as (
    select project_id, count(*) as total,
      count(*) filter (where expiry_date >= (now() at time zone 'utc')::date) as ready
    from public.personnel_certifications
    where verified_at is not null and coalesce(lifecycle_status, 'active') = 'active'
    group by project_id
  ),
  c_material as (
    select project_id, count(*) as total,
      count(*) filter (where approval_status in ('A', 'B') and receipt_status = 'released') as ready
    from public.material_register
    where verified_at is not null and coalesce(lifecycle_status, 'active') = 'active'
    group by project_id
  ),
  c_standalone as (
    select project_id, count(*) as total,
      count(*) filter (
        where status = 'completed'
          and (conclusion = 'pass' or (conclusion = 'conditional_pass' and cleared_at is not null))
      ) as ready
    from public.standalone_assignments
    group by project_id
  ),
  c_ncrs as (
    select project_id, count(*) as total,
      count(*) filter (where status = 'closed') as ready
    from public.ncrs
    where severity is null or severity <> 'observation'
    group by project_id
  ),
  c_punch as (
    select project_id, count(*) as open_items
    from public.punch_list_items
    where status <> 'closed'
    group by project_id
  ),
  c_book as (
    select project_id, count(*) as issued_books
    from public.data_books
    where status = 'issued'
    group by project_id
  ),
  base as (
    select
      p.organization_id, p.id as project_id, p.project_number, p.name as project_name, p.status as project_status,
      coalesce(c_itps.ready, 0) as itps_ready, coalesce(c_itps.total, 0) as itps_total,
      coalesce(c_records.ready, 0) as inspection_records_ready, coalesce(c_records.total, 0) as inspection_records_total,
      coalesce(c_checklists.ready, 0) as checklists_ready, coalesce(c_checklists.total, 0) as checklists_total,
      coalesce(c_calibration.ready, 0) as calibration_ready, coalesce(c_calibration.total, 0) as calibration_total,
      coalesce(c_welder.ready, 0) as welder_ready, coalesce(c_welder.total, 0) as welder_total,
      coalesce(c_personnel.ready, 0) as personnel_ready, coalesce(c_personnel.total, 0) as personnel_total,
      coalesce(c_material.ready, 0) as material_ready, coalesce(c_material.total, 0) as material_total,
      coalesce(c_standalone.ready, 0) as standalone_ready, coalesce(c_standalone.total, 0) as standalone_total,
      coalesce(c_ncrs.ready, 0) as ncrs_ready, coalesce(c_ncrs.total, 0) as ncrs_total,
      coalesce(c_activities.ready, 0) as activities_ready, coalesce(c_activities.total, 0) as activities_total,
      coalesce(c_holds.ready, 0) as hold_points_ready, coalesce(c_holds.total, 0) as hold_points_total,
      coalesce(c_punch.open_items, 0) as open_punch_items,
      (coalesce(c_book.issued_books, 0) > 0) as handover_certificate_issued
    from public.projects p
    left join c_itps on c_itps.project_id = p.id
    left join c_records on c_records.project_id = p.id
    left join c_checklists on c_checklists.project_id = p.id
    left join c_calibration on c_calibration.project_id = p.id
    left join c_welder on c_welder.project_id = p.id
    left join c_personnel on c_personnel.project_id = p.id
    left join c_material on c_material.project_id = p.id
    left join c_standalone on c_standalone.project_id = p.id
    left join c_ncrs on c_ncrs.project_id = p.id
    left join c_activities on c_activities.project_id = p.id
    left join c_holds on c_holds.project_id = p.id
    left join c_punch on c_punch.project_id = p.id
    left join c_book on c_book.project_id = p.id
  ),
  summed as (
    select b.*,
      (itps_ready + inspection_records_ready + checklists_ready + calibration_ready + welder_ready
        + personnel_ready + material_ready + standalone_ready + ncrs_ready + activities_ready + hold_points_ready
      ) as total_ready,
      (itps_total + inspection_records_total + checklists_total + calibration_total + welder_total
        + personnel_total + material_total + standalone_total + ncrs_total + activities_total + hold_points_total
      ) as total_required
    from base b
  )
select
  organization_id, project_id, project_number, project_name, project_status,
  itps_ready, itps_total,
  inspection_records_ready, inspection_records_total,
  checklists_ready, checklists_total,
  calibration_ready, calibration_total,
  welder_ready, welder_total,
  personnel_ready, personnel_total,
  material_ready, material_total,
  standalone_ready, standalone_total,
  ncrs_ready, ncrs_total,
  activities_ready, activities_total,
  hold_points_ready, hold_points_total,
  open_punch_items,
  handover_certificate_issued,
  total_ready,
  total_required,
  -- readiness-math.ts strictPercentage(): 100 if nothing required or all ready, else floor, max 99.
  case
    when total_required <= 0 then 100
    when total_ready >= total_required then 100
    else least(99, greatest(0, floor(100.0 * total_ready / total_required)))::int
  end as overall_percentage,
  (
    itps_ready >= itps_total
    and inspection_records_ready >= inspection_records_total
    and checklists_ready >= checklists_total
    and calibration_ready >= calibration_total
    and welder_ready >= welder_total
    and personnel_ready >= personnel_total
    and material_ready >= material_total
    and standalone_ready >= standalone_total
    and ncrs_ready >= ncrs_total
    and activities_ready >= activities_total
    and hold_points_ready >= hold_points_total
    and open_punch_items = 0
  ) as is_ready
from summed;

comment on view public.vw_powerbi_databook_completeness is
  'Power BI (R110, phase 4): per-project Data Book readiness (ready/total per category, overall percentage, is_ready, open punch items, handover certificate issued). Mirrors computeDataBookReadiness() in apps/web/lib/databook/readiness.ts; see the migration header for what is not reproducible in SQL.';

-- --------------------------------------------------------------------------------------------
-- 10. Activity fact — one row per itp_items row, flat, so ONE Power BI model can slice every
--     activity-level measure by project / ITP / section / discipline / activity.
--     All child tables are pre-aggregated per itp_item_id in CTEs first, so joins never fan out
--     and counts are never multiplied.
--     latest_* = the latest COMPLETED inspection (overall_result not null) — same rule as the
--     Data Book readiness. attempts_count counts every record including drafts;
--     completed_attempts_count only completed ones.
--     is_ready_for_databook mirrors the readiness "activities" rule (checklist-driven activity on
--     an approved/client-accepted ITP whose latest completed inspection is pass/partial).
--     holds_signed_count counts H/W sign-offs satisfying the readiness rule (signed_off, or
--     Witness proceeded_no_response).
-- --------------------------------------------------------------------------------------------
create or replace view public.vw_powerbi_activity_fact as
with
  so as (
    select
      asp.itp_item_id,
      count(*) as parties_count,
      count(*) filter (where asp.intervention = 'H') as hold_count,
      count(*) filter (where asp.intervention = 'W') as witness_count,
      count(*) filter (where asp.intervention = 'R') as review_count,
      count(*) filter (where asp.intervention = 'S') as surveillance_count,
      count(*) filter (where asp.status = 'signed_off') as signed_off_count,
      count(*) filter (where asp.status = 'proceeded_no_response') as proceeded_no_response_count,
      count(*) filter (where asp.status = 'notified') as notified_open_count,
      count(*) filter (where asp.status = 'pending') as pending_count,
      count(*) filter (where asp.intervention in ('H', 'W')) as holds_witness_count,
      count(*) filter (
        where asp.intervention in ('H', 'W')
          and (asp.status = 'signed_off' or (asp.intervention = 'W' and asp.status = 'proceeded_no_response'))
      ) as holds_signed_count
    from public.activity_signoff_progress asp
    group by asp.itp_item_id
  ),
  att as (
    select
      ir.itp_item_id,
      count(*) as attempts_count,
      count(*) filter (where ir.overall_result is not null) as completed_attempts_count,
      count(*) filter (where ir.overall_result = 'fail') as failed_attempts_count,
      max(ir.revision) as max_revision
    from public.inspection_records ir
    group by ir.itp_item_id
  ),
  latest as (
    select distinct on (ir.itp_item_id)
      ir.itp_item_id,
      ir.id as inspection_record_id,
      ir.overall_result,
      ir.inspection_date,
      ir.revision
    from public.inspection_records ir
    where ir.overall_result is not null
    order by ir.itp_item_id, ir.created_at desc, ir.id desc
  ),
  photos as (
    select ir.itp_item_id, count(*) as n
    from public.inspection_photos ph
    join public.inspection_records ir on ir.id = ph.inspection_record_id
    group by ir.itp_item_id
  ),
  insp_docs as (
    select ir.itp_item_id, count(*) as n
    from public.inspection_evidence_documents d
    join public.inspection_records ir on ir.id = d.inspection_record_id
    group by ir.itp_item_id
  ),
  item_docs as (
    select itp_item_id, count(*) as n from public.itp_item_evidence_documents group by itp_item_id
  ),
  meas as (
    select itp_item_id, count(*) as n from public.itp_item_measurements group by itp_item_id
  ),
  exp_rec as (
    select
      itp_item_id,
      count(*) as expected_total,
      count(*) filter (where received_at is not null) as expected_received
    from public.activity_expected_records
    group by itp_item_id
  ),
  chk as (
    select itp_item_id, true as has_checklist from public.checklist_templates
  )
select
  p.organization_id,
  p.id as project_id,
  p.project_number,
  p.name as project_name,
  p.status as project_status,
  i.id as itp_id,
  i.itp_number,
  i.title as itp_title,
  i.status as itp_status,
  i.revision as itp_revision,
  s.id as section_id,
  s.section_number,
  s.title as section_title,
  ii.id as itp_item_id,
  ii.item_number,
  ii.activity,
  ii.evidence_type,
  case ii.evidence_type
    when 1 then 'checklist'
    when 2 then 'document_upload'
    when 3 then 'measurement'
  end as evidence_type_label,
  ii.discipline_id,
  d.code as discipline_code,
  d.name as discipline_name,
  -- parties / intervention levels
  coalesce(so.parties_count, 0) as parties_count,
  coalesce(so.hold_count, 0) as hold_count,
  coalesce(so.witness_count, 0) as witness_count,
  coalesce(so.review_count, 0) as review_count,
  coalesce(so.surveillance_count, 0) as surveillance_count,
  -- sign-off progress
  coalesce(so.signed_off_count, 0) as signed_off_count,
  coalesce(so.proceeded_no_response_count, 0) as proceeded_no_response_count,
  coalesce(so.notified_open_count, 0) as notified_open_count,
  coalesce(so.pending_count, 0) as pending_count,
  coalesce(so.holds_witness_count, 0) as holds_witness_count,
  coalesce(so.holds_signed_count, 0) as holds_signed_count,
  -- inspections
  coalesce(att.attempts_count, 0) as attempts_count,
  coalesce(att.completed_attempts_count, 0) as completed_attempts_count,
  coalesce(att.failed_attempts_count, 0) as failed_attempts_count,
  att.max_revision,
  latest.inspection_record_id as latest_inspection_record_id,
  latest.overall_result as latest_inspection_result,
  latest.inspection_date as latest_inspection_date,
  -- evidence / records
  coalesce(chk.has_checklist, false) as has_checklist,
  coalesce(photos.n, 0) as inspection_photo_count,
  coalesce(insp_docs.n, 0) as inspection_evidence_document_count,
  coalesce(item_docs.n, 0) as item_evidence_document_count,
  coalesce(meas.n, 0) as measurement_count,
  coalesce(exp_rec.expected_total, 0) as expected_records_count,
  coalesce(exp_rec.expected_received, 0) as expected_records_received_count,
  coalesce(photos.n, 0) + coalesce(insp_docs.n, 0) + coalesce(item_docs.n, 0) as evidence_count,
  -- Data Book readiness for this activity (checklist-driven activities on issued ITPs only)
  (
    ii.evidence_type = 1
    and i.status in ('approved', 'client_accepted')
    and latest.overall_result in ('pass', 'partial')
  ) as is_ready_for_databook
from public.itp_items ii
join public.itp_sections s on s.id = ii.section_id
join public.itps i on i.id = s.itp_id
join public.projects p on p.id = i.project_id
left join public.master_disciplines d on d.id = ii.discipline_id
left join so on so.itp_item_id = ii.id
left join att on att.itp_item_id = ii.id
left join latest on latest.itp_item_id = ii.id
left join photos on photos.itp_item_id = ii.id
left join insp_docs on insp_docs.itp_item_id = ii.id
left join item_docs on item_docs.itp_item_id = ii.id
left join meas on meas.itp_item_id = ii.id
left join exp_rec on exp_rec.itp_item_id = ii.id
left join chk on chk.itp_item_id = ii.id;

comment on view public.vw_powerbi_activity_fact is
  'Power BI (R110, phase 4): flat activity-level fact table, one row per itp_item, joining project, ITP, section, discipline, intervention/party counts, sign-off counts, latest inspection result, attempt counts and evidence/expected-record counts so one model can slice everything by activity.';

-- --------------------------------------------------------------------------------------------
-- Access: powerbi_reader only. REVOKE first from the PostgREST roles (Supabase default
-- privileges can grant new public views to anon/authenticated — these views bypass RLS, so that
-- would be a cross-tenant leak; see 20260916140000), then GRANT SELECT to powerbi_reader.
-- --------------------------------------------------------------------------------------------
revoke all on
  public.vw_powerbi_inspection_attempts,
  public.vw_powerbi_signoff_turnaround,
  public.vw_powerbi_databook_completeness,
  public.vw_powerbi_activity_fact
from public, anon, authenticated;

grant select on
  public.vw_powerbi_inspection_attempts,
  public.vw_powerbi_signoff_turnaround,
  public.vw_powerbi_databook_completeness,
  public.vw_powerbi_activity_fact
to powerbi_reader;
