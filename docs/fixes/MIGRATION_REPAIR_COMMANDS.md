# Migration repair: commands to run

Follows the rules in `docs/MIGRATION_REPAIR.md`: no file is renamed or edited; only `schema_migrations` is
touched. Nothing here runs any migration SQL or deletes data. Back up first.

## 1. Look before you write

```bash
supabase migration list
```
```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

## 2. The 7 duplicate versions (both files of each pair must already be live)

```bash
supabase migration repair --status applied 20260910010000 20260910060000 20260910120000 20260916000000 20260917060000 20260919020000 20260929010000
```

| Version | Files (both stay in the repo) |
|---|---|
| `20260910010000` | `20260910010000_phase1_punch_list_databook_handover.sql`, `20260910010000_phase2_document_vault.sql` |
| `20260910060000` | `20260910060000_phase3_ai_usage_log.sql`, `20260910060000_phase3_itp_item_discipline.sql` |
| `20260910120000` | `20260910120000_phase3_activity_expected_records.sql`, `20260910120000_phase3_powerbi_reporting_views.sql` |
| `20260916000000` | `20260916000000_fix_remaining_project_scoped_grants_and_ncr_photos.sql`, `20260916000000_standalone_assignment_discipline.sql` |
| `20260917060000` | `20260917060000_org_brand_colors.sql`, `20260917060000_teams_and_delegation.sql` |
| `20260919020000` | `20260919020000_client_teams.sql`, `20260919020000_self_managed_project_party_access.sql` |
| `20260929010000` | `20260929010000_itp_review_chain.sql`, `20260929010000_party_login_provisioning.sql` |

To undo one: `supabase migration repair --status reverted <version>`.

## 3. The 30 non-numeric files (optional audit rows)

The CLI cannot see these, `db push` ignores them, and they were applied by hand. If you want them listed in
`schema_migrations` for audit, confirm each is live and run `supabase/manual/record_legacy_migrations.sql`
in the SQL editor. It uses synthetic versions of the form `<file date>9NNNNN`. Mapping:

| Synthetic version | Name | File |
|---|---|---|
| `20261009900001` | `legacy_checklist_photo_concurrency_noreason` | `20261009S10001_checklist_photo_concurrency_noreason.sql` |
| `20261009900002` | `legacy_inspection_record_amendments` | `20261009S20001_inspection_record_amendments.sql` |
| `20261009900003` | `legacy_itp_items_planned_date` | `20261009S30001_itp_items_planned_date.sql` |
| `20261009900004` | `legacy_standalone_clearance_record` | `20261009S40001_standalone_clearance_record.sql` |
| `20261011900005` | `legacy_ncr_checklist_item_link` | `20261011A00001_ncr_checklist_item_link.sql` |
| `20261011900006` | `legacy_overdue_hold_points_planned_date` | `20261011C00001_overdue_hold_points_planned_date.sql` |
| `20261012900007` | `legacy_irn_one_live_per_record` | `20261012F20001_irn_one_live_per_record.sql` |
| `20261013900008` | `legacy_ncr_close_guard` | `20261013N10001_ncr_close_guard.sql` |
| `20261013900009` | `legacy_punch_list_priority_photos_reopen` | `20261013N20001_punch_list_priority_photos_reopen.sql` |
| `20261013900010` | `legacy_databook_revision` | `20261013N30001_databook_revision.sql` |
| `20261013900011` | `legacy_vault_controlled_document_immutability` | `20261013N50001_vault_controlled_document_immutability.sql` |
| `20261013900012` | `legacy_itp_master_audit` | `20261013N70001_itp_master_audit.sql` |
| `20261014900013` | `legacy_function_search_path_and_execute_grants` | `20261014A00001_function_search_path_and_execute_grants.sql` |
| `20261014900014` | `legacy_next_document_sequence_org_check` | `20261014A00002_next_document_sequence_org_check.sql` |
| `20261014900015` | `legacy_org_branding_storage_policy_fix` | `20261014A00003_org_branding_storage_policy_fix.sql` |
| `20261014900016` | `legacy_fk_indexes_and_policy_merge` | `20261014A00004_fk_indexes_and_policy_merge.sql` |
| `20261015900017` | `legacy_execution_write_guards` | `20261015S40001_execution_write_guards.sql` |
| `20261015900018` | `legacy_standalone_write_policies` | `20261015S40002_standalone_write_policies.sql` |
| `20261015900019` | `legacy_overdue_holds_witness` | `20261015S40003_overdue_holds_witness.sql` |
| `20261016900020` | `legacy_ncr_write_guards` | `20261016S50001_ncr_write_guards.sql` |
| `20261016900021` | `legacy_punch_write_guards` | `20261016S50002_punch_write_guards.sql` |
| `20261017900022` | `legacy_irn_write_guards` | `20261017S60001_irn_write_guards.sql` |
| `20261017900023` | `legacy_vault_insert_guard` | `20261017S60002_vault_insert_guard.sql` |
| `20261017900024` | `legacy_storage_project_scope` | `20261017S60003_storage_project_scope.sql` |
| `20261017900025` | `legacy_background_jobs_integrity` | `20261017S60004_background_jobs_integrity.sql` |
| `20261018900026` | `legacy_vault_file_generated_document` | `20261018S6B00001_vault_file_generated_document.sql` |
| `20261019900027` | `legacy_data_book_guards` | `20261019S70001_data_book_guards.sql` |
| `20261019900028` | `legacy_issue_handover_rpc` | `20261019S70002_issue_handover_rpc.sql` |
| `20261019900029` | `legacy_acknowledge_handover_hardening` | `20261019S70003_acknowledge_handover_hardening.sql` |
| `20261019900030` | `legacy_project_close_guards` | `20261019S70004_project_close_guards.sql` |

## 4. Check

```bash
supabase migration list
supabase db push --dry-run     # should list only genuinely new migrations
```

If `migration list` shows a Remote-only version (recorded earlier under another timestamp), either leave it or
clear that row with `supabase migration repair --status reverted <version>`.
