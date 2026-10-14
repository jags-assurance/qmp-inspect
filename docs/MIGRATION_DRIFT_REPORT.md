# Migration drift report

Report only. No migration file was changed and nothing was written to the database.
Compared `supabase/migrations/*.sql` (277 files) with the live `supabase_migrations` list (237 rows, project `qbappyddqdnbwbhbzwei`) by normalised name (version prefix stripped, because repo and live versions differ: live versions are the apply timestamps).

Counts: 53 repo-only names, 13 live-only names, remaining 224 match by name.

## Live-only (applied live, no file with that name)

Almost all of these are the same change under a different name, or were applied by hand and later committed under another file name. Pairing is by content, to be confirmed with `git log -S`.

| Live name | Probable repo file |
| --- | --- |
| phase5_fix_insert_checklists_atomic_search_path | `20260915010000_phase5_atomic_checklist_insert` (follow-up fix) |
| fix_remaining_project_scoped_access_grants_and_ncr_photos | `20260916000000_fix_remaining_project_scoped_grants_and_ncr_photos` |
| fix_background_jobs_and_notifications_insert_scoping | folded into phase5 notification / background job files |
| revoke_powerbi_views_from_authenticated_security_fix | `20260916140000_grant_powerbi_views_to_authenticated` (the live state is the REVOKE, so the repo file alone would re-grant: see risk 1) |
| configure_default_numbering_per_project | numbering engine files |
| drop_leftover_access_grants_policy | consolidated policy files |
| performance_missing_fk_indexes_batch2, consolidate_permissive_policies_batch2 | `20260923030000_performance_batch2_indexes_and_policies` |
| itp_items_protect_history_fix_expected_records | ITP history guard files |
| inspection_evidence_delete_policy_narrowed | evidence policy files |
| ncr_close_guard_and_documents | `20261013N10001_ncr_close_guard` |
| vault_file_generated_document | `20261018S6B00001_vault_file_generated_document` |
| revoke_trigger_function_execute_all | `20261118000400_revoke_internal_function_execute` family |

## Repo-only (file exists, name not recorded live)

Group A, foundation files applied before history was tracked (schema is live, so they are applied in effect, only the history rows are missing):
`20260909210000_phase0_tenancy_schema` through `20260911040000_phase4_ncr_root_cause_suggestion` (34 files, including all the duplicate-version pairs listed in `docs/MIGRATION_REPAIR.md`), plus `20260915000000_phase5_notifications`, `20260915010000_phase5_atomic_checklist_insert`, `20260915020000_phase5_realtime_tables`, `20260916000000_fix_remaining_project_scoped_grants_and_ncr_photos`, `20260916140000_grant_powerbi_views_to_authenticated`, `20260918000000_client_itp_creation`, `20260918010000_self_managed_engagement_scope`, `20260918020000_custom_rbac`, `20260923030000_performance_batch2_indexes_and_policies`.

Group B, renamed equivalents of live-only rows: `20261013N10001_ncr_close_guard`, `20261018S6B00001_vault_file_generated_document`, `20261113000200_inspection_evidence_insert_keep_registers_restriction` (live: `inspection_evidence_insert_restore_registers_restriction`).

Group C, genuinely pending (not live as far as the names show; verify each before applying):
`20261208000100_accept_itp_on_behalf`, `20261208000200_ncr_acceptance_requested_at`, `20261208000300_project_completion_databook`, `20261208000400_org_deactivate` (new, this change), `20261208000600_vault_sod`, `20261208000700_inbound_quarantine`, `20261209000100_correction_requests`, `20261209000200_punch_admin_override`.
Note `20261208000500` is intentionally absent (numbering fallback needed no migration).

## Risks

1. Re-running Group A files on live is unsafe even though they are idempotent: some were later superseded (for example the PowerBI grant is revoked live).
2. `supabase db push` would try to apply Group A and B. Do not run it until history is repaired.
3. Group C migrations are the only real schema gap. Code that depends on them (for example `accept_itp_on_behalf`) fails type generation until applied.

## Safe procedure

Follow `docs/MIGRATION_REPAIR.md`. In short:
1. Take a backup.
2. For Group A and B, mark as applied without running: `supabase migration repair --status applied <version>` per file (only after confirming the objects exist in live).
3. For each Group C file, review it, apply on the staging database first (see `docs/ENVIRONMENTS.md`), then production, in filename order.
4. Re-run this comparison; expect no repo-only entries except intentionally skipped ones.
