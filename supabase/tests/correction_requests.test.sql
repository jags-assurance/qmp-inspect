-- Rolled-back test for 20261209000100_correction_requests.sql. Run: begin; <migration>; <this file>; (raises RESULTS, rolls back)
-- Replace the uuids with a non-staff project member (REQ), an unrelated non-staff user (OTHER), an admin (ADM),
-- a project (PRJ) and an inspection record of it (REC).
do $t$
declare r text := ''; rid uuid; n int;
  REQ constant uuid := '99130500-cfba-4d83-916f-18ac261118d9';
  OTHER constant uuid := '1253ddeb-dda5-4c01-8000-436a98f32e26';
  ADM constant uuid := '14fc1267-ecc6-4431-b5b7-c58923c7b728';
  PRJ constant uuid := 'c0000000-0000-0000-0000-000000000001';
  REC constant uuid := '88a3a5c7-0d01-4580-84ee-7b4d8d445670';
begin
  perform set_config('request.jwt.claims', json_build_object('sub',REQ,'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into inspection_correction_requests(inspection_record_id,project_id,requested_by,reason) values (REC,PRJ,REQ,'short');
    r := r||'1 short reason NOT refused; ';
  exception when others then r := r||'1 short reason refused; '; end;
  begin
    insert into inspection_correction_requests(inspection_record_id,project_id,requested_by,reason) values (REC,PRJ,OTHER,'impersonated request reason');
    r := r||'2 impersonation NOT refused; ';
  exception when others then r := r||'2 impersonation refused; '; end;
  insert into inspection_correction_requests(inspection_record_id,project_id,requested_by,reason) values (REC,PRJ,REQ,'Wrong result ticked on item 3') returning id into rid;
  r := r||'3 own insert ok; ';
  select count(*) into n from inspection_correction_requests; r := r||'4 requester sees '||n||'; ';
  update inspection_correction_requests set status='approved' where id=rid; get diagnostics n = row_count;
  r := r||'5 requester self-approve rows='||n||'; ';
  perform set_config('request.jwt.claims', json_build_object('sub',OTHER,'role','authenticated')::text, true);
  select count(*) into n from inspection_correction_requests; r := r||'6 unrelated user sees '||n||'; ';
  perform set_config('request.jwt.claims', json_build_object('sub',ADM,'role','authenticated')::text, true);
  select count(*) into n from inspection_correction_requests; r := r||'7 admin sees '||n||'; ';
  begin
    update inspection_correction_requests set status='declined' where id=rid;
    r := r||'8 decline w/o note NOT refused; ';
  exception when others then r := r||'8 decline w/o note refused; '; end;
  update inspection_correction_requests set status='declined', resolution_note='Not needed, result is correct' where id=rid; get diagnostics n = row_count;
  r := r||'9 admin decline rows='||n||' resolved_by_set='||((select resolved_by from inspection_correction_requests where id=rid)=ADM)||'; ';
  begin
    update inspection_correction_requests set status='approved' where id=rid;
    r := r||'10 re-resolve NOT refused; ';
  exception when others then r := r||'10 re-resolve refused; '; end;
  reset role;
  raise exception 'RESULTS: %', r;
end $t$;
