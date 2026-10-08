#!/usr/bin/env bash
# Migration history repair: 31 non-numeric filenames + 7 duplicate versions.
# Generated; run from the repo root. Nothing here deletes data or re-runs SQL:
#   - `git mv` only renames files so the Supabase CLI can see them (it ignores names whose version
#     is not purely digits, and cannot track two files that share a version).
#   - `supabase migration repair --status applied` only writes a row into
#     supabase_migrations.schema_migrations; it does NOT execute the migration.
# Every migration below is already live (applied by hand / via the dashboard), so marking it
# applied is correct. Review `supabase migration list` before and after (see docs/fixes/MIGRATION_REPAIR.md).
#
# Usage:  bash supabase/manual/repair_migration_history.sh          # prints the commands (dry run)
#         bash supabase/manual/repair_migration_history.sh --run    # executes them
set -euo pipefail
RUN=0; [ "${1:-}" = "--run" ] && RUN=1
do_it() { if [ "$RUN" = 1 ]; then echo "+ $*"; "$@"; else echo "$*"; fi; }
cd "$(git rev-parse --show-toplevel)"

# ---- 1. Renames (git history preserved) ----
do_it git mv supabase/migrations/20260910010000_phase2_document_vault.sql supabase/migrations/20260910010001_phase2_document_vault.sql
do_it git mv supabase/migrations/20260910060000_phase3_itp_item_discipline.sql supabase/migrations/20260910060001_phase3_itp_item_discipline.sql
do_it git mv supabase/migrations/20260910120000_phase3_powerbi_reporting_views.sql supabase/migrations/20260910120001_phase3_powerbi_reporting_views.sql
do_it git mv supabase/migrations/20260916000000_standalone_assignment_discipline.sql supabase/migrations/20260916000001_standalone_assignment_discipline.sql
do_it git mv supabase/migrations/20260917060000_teams_and_delegation.sql supabase/migrations/20260917060001_teams_and_delegation.sql
do_it git mv supabase/migrations/20260919020000_self_managed_project_party_access.sql supabase/migrations/20260919020001_self_managed_project_party_access.sql
do_it git mv supabase/migrations/20260929010000_party_login_provisioning.sql supabase/migrations/20260929010001_party_login_provisioning.sql
do_it git mv supabase/migrations/20261009S10001_checklist_photo_concurrency_noreason.sql supabase/migrations/20261009100000_checklist_photo_concurrency_noreason.sql
do_it git mv supabase/migrations/20261009S20001_inspection_record_amendments.sql supabase/migrations/20261009110000_inspection_record_amendments.sql
do_it git mv supabase/migrations/20261009S30001_itp_items_planned_date.sql supabase/migrations/20261009120000_itp_items_planned_date.sql
do_it git mv supabase/migrations/20261009S40001_standalone_clearance_record.sql supabase/migrations/20261009130000_standalone_clearance_record.sql
do_it git mv supabase/migrations/20261011A00001_ncr_checklist_item_link.sql supabase/migrations/20261011100000_ncr_checklist_item_link.sql
do_it git mv supabase/migrations/20261011C00001_overdue_hold_points_planned_date.sql supabase/migrations/20261011110000_overdue_hold_points_planned_date.sql
do_it git mv supabase/migrations/20261012F20001_irn_one_live_per_record.sql supabase/migrations/20261012100000_irn_one_live_per_record.sql
do_it git mv supabase/migrations/20261013N10001_ncr_close_guard.sql supabase/migrations/20261013100000_ncr_close_guard.sql
do_it git mv supabase/migrations/20261013N20001_punch_list_priority_photos_reopen.sql supabase/migrations/20261013110000_punch_list_priority_photos_reopen.sql
do_it git mv supabase/migrations/20261013N30001_databook_revision.sql supabase/migrations/20261013120000_databook_revision.sql
do_it git mv supabase/migrations/20261013N50001_vault_controlled_document_immutability.sql supabase/migrations/20261013130000_vault_controlled_document_immutability.sql
do_it git mv supabase/migrations/20261013N70001_itp_master_audit.sql supabase/migrations/20261013140000_itp_master_audit.sql
do_it git mv supabase/migrations/20261014A00001_function_search_path_and_execute_grants.sql supabase/migrations/20261014100000_function_search_path_and_execute_grants.sql
do_it git mv supabase/migrations/20261014A00002_next_document_sequence_org_check.sql supabase/migrations/20261014110000_next_document_sequence_org_check.sql
do_it git mv supabase/migrations/20261014A00003_org_branding_storage_policy_fix.sql supabase/migrations/20261014120000_org_branding_storage_policy_fix.sql
do_it git mv supabase/migrations/20261014A00004_fk_indexes_and_policy_merge.sql supabase/migrations/20261014130000_fk_indexes_and_policy_merge.sql
do_it git mv supabase/migrations/20261015S40001_execution_write_guards.sql supabase/migrations/20261015100000_execution_write_guards.sql
do_it git mv supabase/migrations/20261015S40002_standalone_write_policies.sql supabase/migrations/20261015110000_standalone_write_policies.sql
do_it git mv supabase/migrations/20261015S40003_overdue_holds_witness.sql supabase/migrations/20261015120000_overdue_holds_witness.sql
do_it git mv supabase/migrations/20261016S50001_ncr_write_guards.sql supabase/migrations/20261016100000_ncr_write_guards.sql
do_it git mv supabase/migrations/20261016S50002_punch_write_guards.sql supabase/migrations/20261016110000_punch_write_guards.sql
do_it git mv supabase/migrations/20261017S60001_irn_write_guards.sql supabase/migrations/20261017100000_irn_write_guards.sql
do_it git mv supabase/migrations/20261017S60002_vault_insert_guard.sql supabase/migrations/20261017110000_vault_insert_guard.sql
do_it git mv supabase/migrations/20261017S60003_storage_project_scope.sql supabase/migrations/20261017120000_storage_project_scope.sql
do_it git mv supabase/migrations/20261017S60004_background_jobs_integrity.sql supabase/migrations/20261017130000_background_jobs_integrity.sql
do_it git mv supabase/migrations/20261018S6B00001_vault_file_generated_document.sql supabase/migrations/20261018100000_vault_file_generated_document.sql
do_it git mv supabase/migrations/20261019S70001_data_book_guards.sql supabase/migrations/20261019100000_data_book_guards.sql
do_it git mv supabase/migrations/20261019S70002_issue_handover_rpc.sql supabase/migrations/20261019110000_issue_handover_rpc.sql
do_it git mv supabase/migrations/20261019S70003_acknowledge_handover_hardening.sql supabase/migrations/20261019120000_acknowledge_handover_hardening.sql
do_it git mv supabase/migrations/20261019S70004_project_close_guards.sql supabase/migrations/20261019130000_project_close_guards.sql
do_it git mv supabase/migrations/20261020C00001_handover_certificate_write_lock.sql supabase/migrations/20261020100000_handover_certificate_write_lock.sql

# ---- 2. Record the renamed versions as applied (no SQL is executed) ----
do_it supabase migration repair --status applied 20260910010001
do_it supabase migration repair --status applied 20260910060001
do_it supabase migration repair --status applied 20260910120001
do_it supabase migration repair --status applied 20260916000001
do_it supabase migration repair --status applied 20260917060001
do_it supabase migration repair --status applied 20260919020001
do_it supabase migration repair --status applied 20260929010001
do_it supabase migration repair --status applied 20261009100000
do_it supabase migration repair --status applied 20261009110000
do_it supabase migration repair --status applied 20261009120000
do_it supabase migration repair --status applied 20261009130000
do_it supabase migration repair --status applied 20261011100000
do_it supabase migration repair --status applied 20261011110000
do_it supabase migration repair --status applied 20261012100000
do_it supabase migration repair --status applied 20261013100000
do_it supabase migration repair --status applied 20261013110000
do_it supabase migration repair --status applied 20261013120000
do_it supabase migration repair --status applied 20261013130000
do_it supabase migration repair --status applied 20261013140000
do_it supabase migration repair --status applied 20261014100000
do_it supabase migration repair --status applied 20261014110000
do_it supabase migration repair --status applied 20261014120000
do_it supabase migration repair --status applied 20261014130000
do_it supabase migration repair --status applied 20261015100000
do_it supabase migration repair --status applied 20261015110000
do_it supabase migration repair --status applied 20261015120000
do_it supabase migration repair --status applied 20261016100000
do_it supabase migration repair --status applied 20261016110000
do_it supabase migration repair --status applied 20261017100000
do_it supabase migration repair --status applied 20261017110000
do_it supabase migration repair --status applied 20261017120000
do_it supabase migration repair --status applied 20261017130000
do_it supabase migration repair --status applied 20261018100000
do_it supabase migration repair --status applied 20261019100000
do_it supabase migration repair --status applied 20261019110000
do_it supabase migration repair --status applied 20261019120000
do_it supabase migration repair --status applied 20261019130000
do_it supabase migration repair --status applied 20261020100000

# ---- 3. Check ----
do_it supabase migration list
echo "Any remaining 'Remote' row with no matching 'Local' row is a version recorded under an older"
echo "name. Mark each reverted so db push stops complaining (this only deletes the history row):"
echo "  supabase migration repair --status reverted <that-version>"
