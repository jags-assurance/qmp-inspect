# Fix report: Stage 5 (NCR / punch list), Stage 4 (site execution), offline items C-01..C-09

Branch: `worktree-agent-aec67737d8e4f8211` (merged with dev at ab9f988). Migrations: `20261102000100` .. `20261102000500`.
Every code path that needs a new DB object catches 42703 / 42P01 / 42883 / PGRST202 / PGRST204 / PGRST205 and falls back to the previous behaviour, so the web app can deploy before the migrations are applied.

## Findings

| ID | Status | What changed | Notes |
|---|---|---|---|
| S5-01 | FIXED | `next.config.ts` `experimental.serverActions.bodySizeLimit = "4mb"`; `lib/media/compress-form-photos.ts`; NCR raise, punch add, resolve and walkdown forms compress photos client-side and refuse to submit over budget | 4 MB stays under the ~4.5 MB serverless cap |
| S5-02 | FIXED | `lib/ncrs/recipients.ts` (service-role directory reads, ids/names only); used by NCR actions, load-detail, raise-options, punch notifications, punch list names | Needs `SUPABASE_SERVICE_ROLE_KEY` on Vercel (already used by other routes); without it falls back to old (narrow) behaviour |
| S5-03 | FIXED | Trigger accepts responsible party + its team members (`is_party_user`); app passes `partyMemberIds`; real trigger message surfaced (`dbMessage`) instead of "changed meanwhile" | `20261102000300` |
| S5-04 | FIXED | Trigger close/re-open/withdraw = `can_close_ncr` (admin staff or close_ncr holder); `canEditCapa` now lets closers edit while pending verification; punch cascade carve-out also allows close_ncr holders | Behaviour change: staff inspectors can no longer close via API |
| S5-05 | FIXED | NCR edit syncs due date / party to its open punch items; NCR assignee and party members may resolve the NCR's punch item (trigger); reopen clears fix photos | Blocking reopen of NCR-sourced punch while NCR closed: trigger only allows the NCR re-open cascade (`v_cascade_reopen`), others need close_punch_item and the NCR close state is not re-checked in app (PARTIAL for that sub-point) |
| S5-06 | FIXED | `linkNcrDocumentAction` / `unlinkNcrDocumentAction` / `addNcrPhotoAction` require `canWorkNcr` and the pending-verification lock; `ncr_evidence_write_guard` mirrors it; upload widget hidden when not permitted | |
| S5-07 | FIXED | Trigger guards description/requirement/location (raiser or staff, not after verification), CAPA columns (workers; locked pending), linkage columns immutable; insert validates ITP item / inspection / checklist item belong to the project and forces status open; `createNcrAction` validates links; new `editNcrDetailsAction` | |
| S5-08 | FIXED | Punch trigger: `source_*` validated on insert and immutable; cascade carve-out only when the source NCR is really closed / re-opened; planning columns limited to verifiers, staff or the NCR's team | `20261102000400` |
| S5-09 | FIXED | Evidence required at send-for-verification in `setNcrStatusAction` and the trigger (root cause also required in trigger) | Behaviour change |
| S5-10 | FIXED | `createPunchItemFromSource` defaults due date by priority (A 7d, B 14d, C 30d); failed inspection / FAT fail are priority A, deduped | FAT fail keeps `source: manual` (adding a new source value needs a CHECK change); origin is visible through `source_standalone_assignment_id` link. PARTIAL for the tag |
| S5-11 | FIXED | `ensureNcrPunchItemAction` + "Create missing punch item" button on the NCR page | |
| S5-12 | FIXED | `selfVerificationCheck`: assignee / CAPA author (`ncrs.capa_updated_by`) cannot close; admins need an override reason (audited, stored in `close_override_reason`); trigger blocks non-admins | DB does not require the admin reason (app does) |
| S5-13 | FIXED | Register stats paged with `fetchAll`; CSV export pages up to 5000 rows, adds assignee, party, CAPA, extended columns and a truncation note | |
| S5-14 | FIXED | `client_request_id` idempotency on punch add and walkdown; add form resets and confirms | Unique index in `20261102000200` |
| S5-15 | PARTIAL | Fix photo now required (action + form); closing photos cleared on reopen (punch and NCR cascade); images compressed to JPEG client-side where the browser can decode HEIC | HEIC on Chrome/Android cannot be decoded in the browser: stored as-is |
| S5-16 | FIXED | Punch panel links to NCR / inspection / assignment; NCR page lists punch items, links to the project punch list and the inspection | |
| S5-17 | FIXED | `withdrawNcrAction` (closed + `withdrawn_*`, duplicate-of), `withdrawPunchItemAction`, trigger rules; withdrawn items are status closed so Data Book / handover gates already exclude them; description correction via `editNcrDetailsAction` | KPIs still count them as closed |
| S5-18 | FIXED | `worker/src/escalation.ts` ladder (tier 1 workers, tier 2 + verifiers after 3 days, tier 3 + admins after 7), due-soon reminder (2 days), admin = admin or null role, inactive users dropped, site-date comparison (`SITE_UTC_OFFSET_HOURS`, default 4) | Still needs an enabled `automation_rules` row |
| S5-19 | FIXED | Closure notifies raiser, assignee and party users; rework notifies assignee, raiser and party; reopen stores `last_reopen_reason` / `reopen_count`; history shows 200 entries with resolved names | Email/push not added (existing email hook only) |
| S5-20 | FIXED | Create-form photos validated by magic bytes (`detectPunchImage`), failures reported; `addNcrPhotoAction` checks mime/size of the stored object; widget hidden when not permitted | |
| S5-21 | FIXED | Register guide copy corrected; overdue uses site calendar day (`lib/ncrs/site-date.ts`, `NEXT_PUBLIC_SITE_TIMEZONE`, default Asia/Dubai); dates rendered in site timezone on the NCR page | Other pages still use server-local formatting |
| S5-22 | PARTIAL | New NCR columns (location, equipment tag, spec clause, root-cause category via configurable `ncr_root_cause_categories`, disposition, cost, schedule impact, contractor response); raise form, edit and close-out forms, detail view, CSV | DEFERRED: client acceptance step, per-vendor scorecard, KPI feed, taxonomy admin UI (rows can be inserted by admin staff via API) |
| S5-23 | PARTIAL | `walkdowns` header (date, area, attendees, notes) and `walkdown_id` on items; photo `captured_at` + before/after tag columns and action support; bulk reassign / re-date / re-prioritise for verifiers | DEFERRED: photo markup editor, barcode camera scanning, walkdown PDF / sign-off UI |
| S4-01 | FIXED | `can_execute_itp_item`, `inspection_completion_blocker`, triggers on inspection_records (insert/complete), checklist_responses, inspection_photos | `20261102000500` |
| S4-02 | DEFERRED to agent A | Lives in `issueIrnAction` (A owns). Fix: look only for a live IRN (`voided_at is null`) and let the partial unique index guard | |
| S4-03 | FIXED | Route returns `updatedAt`; sync client rebases later queued answers for the same item onto the new baseline | |
| S4-04 | FIXED | `completeInspectionCore` uses the record's own template | |
| S4-05 | PARTIAL | Service worker caches field pages per user (checklists, inspections, standalone, start-work) + "Save these checklists for offline"; reload/relaunch works for visited pages | DEFERRED: queueing "start inspection" and NCR options offline; client-side validation of completion rules before queueing |
| S4-06 | FIXED | `captured_at` sent for every queued item; used for `signed_at`, photo and signature times (bounded to 30 days, not future); columns in `20261102000100` | EXIF/GPS not added |
| S4-07 | FIXED | `canCompleteInspection` fails closed and counts blocking levels with no progress row; unnotified Witness blocks completion; DB `item_has_open_hold` | Planned-date/notice waiver flow NOT added (PARTIAL); behaviour change for unnotified Witness |
| S4-08 | FIXED | Withdraw needs admin / team lead and no live IRN on the activity | |
| S4-09 | PARTIAL | `activity_signoff_progress_guard`: on-behalf and withdraw need admin / team lead (`is_team_lead_for_project`) | Reopen still any staff in DB (amendment row cannot be enforced atomically without an RPC; app requires admin/team lead) |
| S4-10 | FIXED | Members sign off (action, trigger) and see the executable checklist page | |
| S4-11 | FIXED / NOT AN ISSUE (policy) | Storage insert policy already admits contractors via `can_run_standalone_assignment` (20261015S40002); route now answers 422 on permission refusal instead of 500 | |
| S4-12 | FIXED | Separate `irns_issue_gates_guard` insert trigger (holds, mandatory N/A on partial, open NCR); `irns_write_guard` untouched | |
| S4-13 | FIXED | Failure punch item checked, retried once, deduped by record, staff notified when it fails; a pass after reopen withdraws the old item | |
| S4-14 | FIXED | Location marked required; Start disabled until chosen | |
| S4-15 | FIXED | Completion form confirms, catches dropped connections (queues instead of losing the signature) | Alias name still free text |
| S4-16 | FIXED | Waiver stripped on recompletion; non-staff cannot waive on a failed inspection | Dashboard flag for waivers not added |
| S4-17 | DEFERRED | Accuracy / timestamp / geofence need a schema and project geometry decision | |
| S4-18 | DEFERRED | Release comment / reject outcome / read receipts need a product decision | |
| S4-19 | PARTIAL | Re-starting a released activity blocked; reopen clears `signed_by_user_id`; waiver prefix not duplicated | Project-timezone notice maths and orphan photo cleanup not done |
| S4-20 | PARTIAL | `/inspect/start-work/find?code=<checklist number>` QR deep link; offline page save; bulk punch actions | DEFERRED: numeric response type with tolerance, photo markup, voice, clone-last-inspection, push, hold SLA dashboard |
| C-01 | FIXED | Queue photos squeezed under 3 MB (`lib/offline/photo-prepare.ts`), 413 treated as permanent rejection with a clear message, limits unified, `maxDuration` on the route | |
| C-02 | FIXED | `client_key` columns + unique indexes; actions dedupe by key; before the migration only an identical reading in the last 5 minutes is treated as a replay | |
| C-03 | FIXED | New `public/sw.js` | |
| C-04 | FIXED | No auto `skipWaiting`; update asks for confirmation and mentions queued items; no timed reload | |
| C-05 | FIXED | Only 5xx from our handler count (5 tries, exponential backoff); network/gateway failures never exhaust the budget | |
| C-06 | PARTIAL | Banner shows queue size and age, nags after 3 days, "Export queue" JSON | |
| C-07 | FIXED | Items stamped with user id; replay only for the owner (client and `X-Queued-User` check on the server) | |
| C-08 | FIXED | Key-derived photo path, errors checked and retried | |
| C-09 | FIXED | `offline.html` shows queued count, home link, Arabic text; manifest scope + shortcuts | |

## MANUAL STEPS

1. Deploy order: the web app is safe to deploy first; apply migrations afterwards. The earlier S-prefixed files (`20261015S40001`, `20261016S50001/2`, `20261017S60001` ...) are skipped by the CLI because of their names; they must already be applied by hand because the new migrations depend on `is_system_caller()` (20261015S40001), the NCR/punch guards and `irns_write_guard`.
2. Apply in this order (all idempotent): `20261102000100_offline_client_keys_and_capture_time.sql`, `20261102000200_ncr_punch_schema_and_helpers.sql`, `20261102000300_ncr_write_guards_v2.sql`, `20261102000400_punch_write_guards_v2.sql`, `20261102000500_execution_guards_v2.sql`.
3. Check before applying 000300 / 000500 that no live flow depends on the old rules:
   - `select count(*) from ncrs where status = 'pending_verification' and not exists (select 1 from ncr_photos p where p.ncr_id = ncrs.id) and not exists (select 1 from ncr_documents d where d.ncr_id = ncrs.id);` (such NCRs can no longer be sent for verification without evidence; existing ones are unaffected).
   - Users with `staff_role = 'inspector'` who currently close NCRs, sign on behalf or withdraw sign-offs will be refused.
4. Env: `SUPABASE_SERVICE_ROLE_KEY` must be set for the web app (recipient lookups, assignee picker, names). Optional: `NEXT_PUBLIC_SITE_TIMEZONE` (default `Asia/Dubai`); worker `SITE_UTC_OFFSET_HOURS` (default 4).
5. Worker: redeploy; make sure an enabled `automation_rules` row exists for `ncr_overdue` and `punch_overdue` per organisation (without one nothing escalates).
6. Smoke test after applying: raise an NCR from a checklist; subcontractor saves CAPA, attaches a photo, "Send for verification"; admin verifies and closes (if the admin is also the assignee, an override reason is now required); punch resolve (photo required) and verify; inspector completes an inspection with signature; IRN issue; an offline replay of an answer, a photo and a completion; then withdraw a test NCR.
7. Decisions needed: whether unnotified Witness points should block completion (currently yes); whether to add a `fat_failure` punch source value; project timezone as a real project setting instead of an env default; product decisions for S4-17, S4-18 and S5-22/23 deferred parts.
8. Agent A: apply the S4-02 change in `issueIrnAction` (and if A redefines `irns_write_guard`, my `irns_issue_gates_guard` is a separate trigger and does not conflict).
