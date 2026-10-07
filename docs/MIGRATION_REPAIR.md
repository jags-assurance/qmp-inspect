# Migration history repair (local files vs live `schema_migrations`)

Why this exists: `supabase/migrations/` and the live database's `supabase_migrations.schema_migrations`
table have drifted. Many migrations were applied by hand in the SQL editor, and some files have names
the Supabase CLI cannot track. Until this is reconciled, `supabase db push` either skips files,
refuses to run, or tries to re-apply things that are already live.

## What is wrong (as of 2026-11)

| Problem | Count | Effect |
| --- | --- | --- |
| **Duplicate versions**: two files share the same 14-digit prefix | 7 versions (14 files) | `schema_migrations.version` is a primary key, so only one of each pair can ever be recorded; `db push` fails on the second |
| **Non-numeric versions**: names like `20261009S10001_...`, `20261011A00001_...`, `20261019S70002_...` | 30 files | The CLI only recognises `<digits>_<name>.sql`, so these are silently ignored by `db push` and `migration list`. They were applied by hand |

The 7 duplicate versions:

| Version | Files |
| --- | --- |
| `20260910010000` | `..._phase1_punch_list_databook_handover.sql`, `..._phase2_document_vault.sql` |
| `20260910060000` | `..._phase3_ai_usage_log.sql`, `..._phase3_itp_item_discipline.sql` |
| `20260910120000` | `..._phase3_activity_expected_records.sql`, `..._phase3_powerbi_reporting_views.sql` |
| `20260916000000` | `..._fix_remaining_project_scoped_grants_and_ncr_photos.sql`, `..._standalone_assignment_discipline.sql` |
| `20260917060000` | `..._org_brand_colors.sql`, `..._teams_and_delegation.sql` |
| `20260919020000` | `..._client_teams.sql`, `..._self_managed_project_party_access.sql` |
| `20260929010000` | `..._itp_review_chain.sql`, `..._party_login_provisioning.sql` |

The exact list of the 30 non-numeric files is `nonNumeric` in
`scripts/migration-names-baseline.json` (or `ls supabase/migrations | grep -vE '^[0-9]{14}_'`).

## Ground rules

1. **Never rename or edit an existing migration file.** Renaming changes the version/checksum other
   environments already recorded. Repair the *history table*, not the files.
2. **Back up first** (Supabase dashboard > Database > Backups, or a manual backup).
3. **Do not run `db push` until the history is reconciled** and `supabase migration list` shows no
   unexpected "local only" rows.
4. All new migrations use a pure 14-digit numeric version and a unique one
   (`YYYYMMDDHHMMSS_description.sql`). CI enforces this (see below).
5. Every migration must be idempotent (`create ... if not exists`, `create or replace`,
   `drop ... if exists`), because several environments reached the same state by different routes.

## Step 1: see what the live database thinks is applied

In the SQL editor (or `supabase db query --linked`):

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;
```

Then, from the repo:

```bash
supabase link --project-ref <ref>      # once
supabase migration list                # local vs remote columns side by side
```

`migration list` only shows files with numeric versions; the 30 non-numeric ones never appear.

## Step 2: classify every local file

For each file in `supabase/migrations/`, decide one of:

- **Recorded and applied**: version appears in `schema_migrations`. Nothing to do.
- **Applied but not recorded** (applied by hand): verify by checking the object it creates exists
  (table/column/function/policy), then mark it applied (Step 3).
- **Not applied**: apply it (SQL editor, one file at a time, or `db push` once history is clean).
- **Superseded**: a later migration redefines the same objects; applying it again would be harmless
  if idempotent, but you may mark it applied after confirming the final state matches.

Verification queries that help:

```sql
-- functions the hand-applied security guards define
select proname from pg_proc
where proname in ('is_system_caller','is_admin_staff','is_jags_staff','project_write_guard',
                  'close_project','issue_data_book_handover','acknowledge_handover');

-- tables / columns
select to_regclass('public.auth_attempts');
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'ncrs';

-- policies
select schemaname, tablename, policyname from pg_policies where schemaname in ('public','storage');
```

## Step 3: mark already-applied numeric migrations as applied

```bash
supabase migration repair --status applied 20260910000000 20260910020000   # list the versions
supabase migration list                                                      # re-check
```

`repair --status applied` only inserts a row into `schema_migrations`; it does not run the SQL.
To undo a mistaken mark: `supabase migration repair --status reverted <version>`.

### The 7 duplicate versions

Only one row per version can exist, and the CLI maps a version to a single file, so:

1. Confirm in the database that **both** files' effects are present (they have different content;
   the objects each creates should exist).
2. Record the version once: `supabase migration repair --status applied <version>`.
3. Leave both files in the repo. Because the version is already recorded, `db push` will not
   try to run either. CI grandfathers them (`duplicates` in the baseline file); no new duplicates are
   allowed.

If one of the pair is **not** applied, apply it by hand in the SQL editor first, then record the
version as above.

### The 30 non-numeric files

The CLI cannot record these, and renaming is forbidden. Options, in order of preference:

1. **Leave them out of the CLI's view.** They were applied by hand; confirm each one's effect is live
   (verification queries above, or the finding ID in the file's header comment) and keep a note in
   the table below. Nothing more is needed for `db push` to work, because it ignores them.
2. For any that are **not** live, apply the file by hand in the SQL editor before any migration
   that depends on it (the newer guards call functions from `S40001`, `S50001`, `S70001..4`).
3. If you want them in `schema_migrations` for audit purposes, insert a row with a synthetic
   numeric version that does not collide with any real one, for example a version later than the
   newest file you are recording and a name matching the file:

   ```sql
   insert into supabase_migrations.schema_migrations (version, name)
   values ('20261019900001', 'legacy_s70002_issue_handover_rpc')
   on conflict (version) do nothing;
   ```

   This is optional bookkeeping and changes no schema.

Keep a record while you work (copy this table into your change notes):

| File | Verified live? | Date | By |
| --- | --- | --- | --- |
| `20261009S10001_checklist_photo_concurrency_noreason.sql` | | | |
| ... one row per file in `nonNumeric` ... | | | |

## Step 4: confirm `db push` is safe

```bash
supabase migration list     # every numeric local file should have a remote value
supabase db push --dry-run  # should list only genuinely new migrations
```

If `--dry-run` lists anything you know is already live, mark it applied (Step 3) rather than pushing.

## CI guard for new migrations

`scripts/check-migration-names.mjs` (run as `pnpm check:migrations` and in the `migration-names` CI job)
fails the build when a migration file:

- does not match `^\d{14}_<name>.sql` (exactly 14 digits, then an underscore), or
- shares its version with another file.

The 30 legacy non-numeric files and 14 files in duplicate-version pairs are grandfathered in
`scripts/migration-names-baseline.json`. Do **not** add a new file to that baseline to make CI pass:
rename the new file instead (it has not been applied anywhere yet, so renaming is safe). The baseline
should only ever shrink.

Choosing a version for a new migration: take the current UTC time or the next free number after the
newest file, 14 digits, e.g. `20261108000101_add_foo.sql`.

## Related

- `supabase/MIGRATIONS.md`: forward-only discipline and pre-push checklist.
- `docs/fixes/REMAINING.md` section A: ordered list of the recent migrations to apply.
