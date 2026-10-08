# Migration history repair

The Supabase CLI only tracks migrations whose filename starts with a purely numeric version followed by `_`,
and one version can appear once. This repo has:

- **31 files** with a letter in the version (`20261009S10001_...`). The CLI skips them, so `db push` never sees them.
- **7 versions used by two files** (`20260910010000_...` twice, and six more). Only one row per version can be recorded.

All of these migrations are already live. The fix is to rename the files to unique numeric versions and record
those versions as applied, without running any SQL.

## Run

```bash
supabase migration list                                   # 1. save this output first
bash supabase/manual/repair_migration_history.sh          # 2. dry run: prints every command
bash supabase/manual/repair_migration_history.sh --run    # 3. rename + record as applied
supabase migration list                                   # 4. Local and Remote columns should now match
```

If step 4 shows a `Remote`-only version (the dashboard or an earlier tool recorded the same migration under a
different timestamp), clear that row; it deletes history only, not data:

```bash
supabase migration repair --status reverted <that-version>
```

Do this before the first `db push` after the rename. Commit the renames together in one commit.

## Mapping (38 files)

For a duplicate version the alphabetically first file keeps the version and the other moves up by one second.
Non-numeric files get `<date>` + `100000`, `110000`, ... in filename order for that day, which keeps their
relative order and does not collide with any existing version (checked when generated).

| Current | New | Reason |
|---|---|---|
| `20260910010000_phase2_document_vault.sql` | `20260910010001_phase2_document_vault.sql` | duplicate version |
| `20260910060000_phase3_itp_item_discipline.sql` | `20260910060001_phase3_itp_item_discipline.sql` | duplicate version |
| `20260910120000_phase3_powerbi_reporting_views.sql` | `20260910120001_phase3_powerbi_reporting_views.sql` | duplicate version |
| `20260916000000_standalone_assignment_discipline.sql` | `20260916000001_standalone_assignment_discipline.sql` | duplicate version |
| `20260917060000_teams_and_delegation.sql` | `20260917060001_teams_and_delegation.sql` | duplicate version |
| `20260919020000_self_managed_project_party_access.sql` | `20260919020001_self_managed_project_party_access.sql` | duplicate version |
| `20260929010000_party_login_provisioning.sql` | `20260929010001_party_login_provisioning.sql` | duplicate version |
| `20261009S10001_checklist_photo_concurrency_noreason.sql` | `20261009100000_checklist_photo_concurrency_noreason.sql` | non-numeric |
| `20261009S20001_inspection_record_amendments.sql` | `20261009110000_inspection_record_amendments.sql` | non-numeric |
| `20261009S30001_itp_items_planned_date.sql` | `20261009120000_itp_items_planned_date.sql` | non-numeric |
| `20261009S40001_standalone_clearance_record.sql` | `20261009130000_standalone_clearance_record.sql` | non-numeric |
| `20261011A00001_ncr_checklist_item_link.sql` | `20261011100000_ncr_checklist_item_link.sql` | non-numeric |
| `20261011C00001_overdue_hold_points_planned_date.sql` | `20261011110000_overdue_hold_points_planned_date.sql` | non-numeric |
| `20261012F20001_irn_one_live_per_record.sql` | `20261012100000_irn_one_live_per_record.sql` | non-numeric |
| `20261013N10001_ncr_close_guard.sql` | `20261013100000_ncr_close_guard.sql` | non-numeric |
| `20261013N20001_punch_list_priority_photos_reopen.sql` | `20261013110000_punch_list_priority_photos_reopen.sql` | non-numeric |
| `20261013N30001_databook_revision.sql` | `20261013120000_databook_revision.sql` | non-numeric |
| `20261013N50001_vault_controlled_document_immutability.sql` | `20261013130000_vault_controlled_document_immutability.sql` | non-numeric |
| `20261013N70001_itp_master_audit.sql` | `20261013140000_itp_master_audit.sql` | non-numeric |
| `20261014A00001_function_search_path_and_execute_grants.sql` | `20261014100000_function_search_path_and_execute_grants.sql` | non-numeric |
| `20261014A00002_next_document_sequence_org_check.sql` | `20261014110000_next_document_sequence_org_check.sql` | non-numeric |
| `20261014A00003_org_branding_storage_policy_fix.sql` | `20261014120000_org_branding_storage_policy_fix.sql` | non-numeric |
| `20261014A00004_fk_indexes_and_policy_merge.sql` | `20261014130000_fk_indexes_and_policy_merge.sql` | non-numeric |
| `20261015S40001_execution_write_guards.sql` | `20261015100000_execution_write_guards.sql` | non-numeric |
| `20261015S40002_standalone_write_policies.sql` | `20261015110000_standalone_write_policies.sql` | non-numeric |
| `20261015S40003_overdue_holds_witness.sql` | `20261015120000_overdue_holds_witness.sql` | non-numeric |
| `20261016S50001_ncr_write_guards.sql` | `20261016100000_ncr_write_guards.sql` | non-numeric |
| `20261016S50002_punch_write_guards.sql` | `20261016110000_punch_write_guards.sql` | non-numeric |
| `20261017S60001_irn_write_guards.sql` | `20261017100000_irn_write_guards.sql` | non-numeric |
| `20261017S60002_vault_insert_guard.sql` | `20261017110000_vault_insert_guard.sql` | non-numeric |
| `20261017S60003_storage_project_scope.sql` | `20261017120000_storage_project_scope.sql` | non-numeric |
| `20261017S60004_background_jobs_integrity.sql` | `20261017130000_background_jobs_integrity.sql` | non-numeric |
| `20261018S6B00001_vault_file_generated_document.sql` | `20261018100000_vault_file_generated_document.sql` | non-numeric |
| `20261019S70001_data_book_guards.sql` | `20261019100000_data_book_guards.sql` | non-numeric |
| `20261019S70002_issue_handover_rpc.sql` | `20261019110000_issue_handover_rpc.sql` | non-numeric |
| `20261019S70003_acknowledge_handover_hardening.sql` | `20261019120000_acknowledge_handover_hardening.sql` | non-numeric |
| `20261019S70004_project_close_guards.sql` | `20261019130000_project_close_guards.sql` | non-numeric |
| `20261020C00001_handover_certificate_write_lock.sql` | `20261020100000_handover_certificate_write_lock.sql` | non-numeric |

## Not covered

`organizations_column_guard` and `revoke_trigger_function_execute` are live but have no local file; see
`20261105000300_revoke_trigger_function_execute.sql` for the latter.
