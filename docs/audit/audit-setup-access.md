# Audit: setup and access (read-only, 2026-10-14)

Scope: organisations, projects, parties, login provisioning, grants/roles, teams, numbering, branding, intervention levels, licensing, auth, nav gating. Method: code trace + read-only SQL on project qbappyddqdnbwbhbzwei. This was a bounded pass; not every form was clicked in a browser (UNVERIFIED for runtime behaviour).

## What works (verified in code / DB)
- Every setup server action checks isAdminStaff (or a self_managed/permission fallback) before writing: createOrganizationAction (lib/organizations/actions.ts:40), createProjectAction (lib/projects/actions.ts:79), updateProjectStatusAction (:981), delete project/org (lib/projects/delete-actions.ts:88,158), rbac (lib/rbac/actions.ts), staff-access, module-licensing, plans, intervention-levels, branding, numbering, teams, client-teams.
- Party login provisioning: temp password with expiry, must_change_password forced via proxy.ts + app_metadata, rollback on failure, hourly rate limit (lib/projects/party-provisioning.ts).
- Auth flows present: /login, /login/mfa, /forgot-password, /reset-password, /auth/confirm, account security page, idle timeout, throttle table.
- Nav: all palette/sidebar hrefs resolve to a page.tsx or route.ts (checked /inspect/* list against app tree, including settings?section=* keys, which all exist in RENDERERS in app/inspect/settings/page.tsx).
- Live DB: 98 public tables, 0 without RLS; org insert/update/delete policies are is_admin_staff(); custom_roles, numbering_configs, branding tables exist; all roles (admin, client, jags, jags_inspector, main_contractor, subcontractor, tpi_lab, vendor) are in use.
- Migrations: repo has 262 files, live tracks 230 versions with none before 20260914 (earlier phase0-phase4 files were applied outside tracking) and repo versions were re-stamped (e.g. 20261203..20261205 vs live 20261013*). Spot checks of repo-only names (custom_roles, is_client_itp_creator, party_login_provisioning, db_level_completion_guards, storage_bucket_limits) show the objects/names exist live. No evidence of an unapplied migration in this area, but a full name diff was only partial: UNVERIFIED.

## Findings

### Critical
None found.

### High
H1. Project-scoped users can write org numbering config and custom roles in self-managed orgs. Policies numbering_configs_i/u/d and custom_roles_i/u/d allow `self_managed AND has_org_access(org)`; has_org_access() returns true for scope_type='project' grants (live pg_get_functiondef). The later "*_self_managed_write" policies correctly require has_org_wide_access, but the older permissive policies were never dropped, so permissive OR defeats migration 20261005181913 (org_settings_require_org_wide_grant). A subcontractor/vendor/TPI with a single project grant in a self_managed org can change numbering formats or create roles via direct API (the server action only checks engagement_scope, not org-wide membership: lib/numbering/actions.ts:185-195, lib/branding/actions.ts:37-48). Size: S (drop policies / use has_org_wide_access; add membership check in actions). Note organizations branding update policy is correct (org-wide).

### Medium
M1. Non-admin numbering/branding actions only check the target org is self_managed, not that the caller belongs to it (relies wholly on the RLS above). Size: S.
M2. No way to rename, deactivate or re-activate an organisation: organizations.is_active exists and is read only in lib/ai/gate.ts; no action/UI sets it (grep of lib/app). Org settings other than branding/numbering/scope are not editable after creation. Size: S-M.
M3. Live data: 8 of 17 projects belong to orgs with no numbering_configs row; 13 active parties have no linked login (expected by design) and 14 users still must_change_password. Confirm numbering falls back to defaults (UNVERIFIED) otherwise IRN/ITP numbering may fail on first use. Size: S to verify.
M4. Inspector (non-admin staff) has no Settings entry and cannot see Teams unless a team lead; layout comments say that is intended, but docs/guides describing inspector tasks (staff access, roles) were not cross-checked: UNVERIFIED.
M5. Migration tracking mismatch: live schema_migrations has 230 rows vs 262 repo files, no rows before 20260914, and version stamps differ for the last ~5 files (db_perf_fk_indexes, signature_png_jpeg, organizations_delete_admin_only, db_level_completion_guards, storage_bucket_limits). A future `supabase db push` could try to re-apply them. docs/MIGRATION_REPAIR.md exists; run a repair before next push. Size: S.

### Low
L1. One staff user has staff_role NULL (treated as admin-equivalent, lib/auth/session.ts) - implicit admin; set an explicit role. Size: S.
L2. Non-staff user's "own org" is `grants.find(g => organization_id)` (layout.tsx:24): a user with grants in multiple orgs sees only the first org's chrome/licensing/nav. Size: M.
L3. Several best-effort `catch {}` blocks swallow audit-log errors (projects/actions.ts:301,478,824; teams/actions.ts) - intentional per comments but failures are invisible. Size: S.
L4. docs/audit folder was empty; no TODO/FIXME/"not implemented" strings found in apps/web app, components, lib (grep returned none).
L5. Vendor role has no distinct nav treatment: only isClientRole differentiates; vendor/main contractor/subcontractor/TPI see identical nav (layout.tsx comment says deliberate first pass). Size: M.

## Not verified at runtime
Browser walk-through of create org -> project -> party -> provision login -> first sign-in -> forced password change; MFA flow; email delivery (RESEND_API_KEY); role-by-role page access beyond code reading.
