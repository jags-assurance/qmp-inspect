# Connecting Power BI to QMP Inspect (R110)

QMP Inspect exposes a small set of secure, read-only SQL views for the JAGS-internal Power BI.
This is **internal only** — clients never get live BI access; they receive the monthly report
pack instead (PDF + Excel/CSV, see R109).

The views and the role that can read them are defined in
`supabase/migrations/20260910120000_phase3_powerbi_reporting_views.sql`.

## What the views are

| View | Covers |
|---|---|
| `public.vw_powerbi_inspections_completed_vs_planned` | Inspections completed vs planned, per project |
| `public.vw_powerbi_itp_completion` | ITP completion % (client-accepted / total), per project |
| `public.vw_powerbi_hold_point_turnaround` | Average Hold-point turnaround hours (signoff-chain data only) |
| `public.vw_powerbi_first_time_pass_rate` | First-time pass rate, per project |
| `public.vw_powerbi_ncr_trends` | Monthly NCR volume and close-out time, by severity/status, per project |

Every view includes `organization_id` and `project_id` so Power BI can slice/filter by client and
project. There is no per-row tenant filtering baked into the views themselves — that is not RLS
(RLS depends on `auth.uid()`, which a Postgres login role like `powerbi_reader` never has). Instead,
isolation comes from **who can connect as `powerbi_reader` at all**: only JAGS-internal staff who
manage the Power BI report. Do not hand the `powerbi_reader` credentials to any client.

## The `powerbi_reader` role

A dedicated Postgres **login** role (Power BI's direct-Postgres connector needs to log in — it does
not go through Supabase Auth or PostgREST). It has:

- `USAGE` on the `public` schema (required just to see the views)
- `SELECT` on the five `vw_powerbi_*` views above — nothing else

It has no access to any other table, view, or function. It cannot write anything.

**The password committed in the migration is a placeholder and is not a real secret.** Before
giving this role to anyone (including internal team members), reset its password from the Supabase
dashboard:

- Supabase Dashboard → **Database** → **Roles** → find `powerbi_reader` → reset password, **or**
- run `alter role powerbi_reader password '<a real, generated secret>';` once from the Supabase SQL
  Editor, logged in as an admin.

## Connecting Power BI Desktop

1. In Power BI Desktop: **Get Data** → **Database** → **PostgreSQL database**.
2. **Server** and **Database**: get these from the Supabase project's own connection-info page —
   Supabase Dashboard → **Project Settings** → **Database** → **Connection info / Connection
   string**. Use the direct connection host and port shown there (not the pooler URL, unless your
   Supabase project requires it — follow whichever host/port Supabase's connection-info page
   labels for direct Postgres client connections) and the database name shown there.
3. **Data Connectivity mode**: choose **Import** or **DirectQuery**.
   - **DirectQuery** gives a live/direct connection — every report visual queries Postgres in real
     time, so Power BI always reflects current data with no manual refresh.
   - **Import** loads a snapshot into Power BI's own storage and needs a refresh schedule to stay
     current.
   - R110 asks for a live reporting connection, so **DirectQuery is the intended mode** for this
     connector; Import is a reasonable fallback if DirectQuery's SQL feature limitations become a
     problem for a specific report.
4. When prompted for credentials, choose **Database** authentication and enter:
   - **User name**: `powerbi_reader`
   - **Password**: the real password you set above (never the placeholder from the migration file)
5. In the Navigator, select only the five `vw_powerbi_*` views listed above (that is all this role
   can see) and load/build your report.

## Notes

- These views are additive and safe to re-run the migration's `create or replace view` statements
  against — no data is modified.
- If a new KPI needs to be added later, add another `vw_powerbi_*` view in a new migration and grant
  `SELECT` on it to `powerbi_reader` explicitly — grants are not automatic for new objects.
- Do not point client-facing tooling at `powerbi_reader`. Clients get the monthly report pack
  (R109), not live Power BI.
