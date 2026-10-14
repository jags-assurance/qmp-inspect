# QMP Inspect — Manual Testing Guide

This walks you through testing the whole application yourself, screen by screen, in the order the
real workflow happens. Everything below has already been tested once by the assistant in this
session against your live Supabase project — this guide is so you can see it yourself and keep
testing as more gets built.

## 1. Running it locally

```bash
cd jags_assurance_project
pnpm install          # first time only
pnpm dev
```

Open **http://localhost:3000**. If you see the login page with the burgundy/gold branding, the app
is running correctly.

If it fails to start or shows a Supabase connection error, check `apps/web/.env.local` has your
real project's URL/anon key (not the placeholder values) — see `apps/web/.env.local.example` for
what each line means.

## 2. Accounts to log in with

All seven real logins are working accounts (created via the Supabase Auth Admin API, not raw SQL —
see `supabase/seed.sql` for why that distinction matters). Every password is the same for all seven:
**`DemoPass123!`**.

| Email | Password | Who they are | Role | Where they land |
|---|---|---|---|---|
| `admin@jagsassurance.local` | `DemoPass123!` | JAGS staff (Oliver Bennett) | **JAGS Admin** — global grant | Platform Home (Orbit hub) |
| `inspector@jagsassurance.local` | `DemoPass123!` | JAGS staff (Ravi Kapoor) | **JAGS Inspector** — global grant | Straight into QMP Inspect |
| `inspector.scoped@jagsassurance.local` | `DemoPass123!` | JAGS staff (Devika Rao) | **JAGS Inspector** — scoped to Meridian Energy only | Straight into QMP Inspect |
| `client@meridian.demo` | `DemoPass123!` | Meridian Energy's own user (Priya Nair) | `client` — org-scoped grant | Straight into QMP Inspect |
| `subcontractor@voltway.demo` | `DemoPass123!` | Voltway Electrical Ltd (Sam Rourke) | `subcontractor` — project-scoped grant | Straight into QMP Inspect |
| `contractor@gfl.demo` | `DemoPass123!` | GFL Engineering & Construction (Maria Alvez) | `main_contractor` — project-scoped grant | Straight into QMP Inspect |
| `tpi@bureauveritas.demo` | `DemoPass123!` | Bureau Veritas (Tom Okafor) | `tpi_lab` — project-scoped grant | Straight into QMP Inspect |

**Use the admin account for almost everything in sections 4–12 below** — nearly every feature that
creates or approves something is staff-only by design (that's the real-world rule: JAGS runs the
inspection process, the client and other parties review, accept, and sign off on their own work).
Log in as each of the other six accounts to confirm tenant isolation, the Admin/Inspector split,
scoped staff access, and the per-party sign-off restriction — see step 13, and the new steps 15–17.

Each of the four non-staff accounts is linked to exactly one `project_parties` row on
`MER-2026-001` (via that row's `user_id` column) — that link is what restricts sign-off to "your
own party only," not just which organisation you belong to. If you ever forget these credentials,
they're also recorded in `supabase/seed.sql` (as a reference, since the actual accounts are created
via the Admin API, not that file) and this file.

### Two kinds of JAGS staff login, not one

Every earlier version of this guide (and the codebase, until this pass) treated "JAGS staff" as one
flat yes/no flag — meaning the admin account could do literally everything, which doesn't match how
JAGS actually operates: an owner/admin is busy running the business (client onboarding, commercial
setup, billing) and delegates the day-to-day inspection work to inspectors on the ground. That's
exactly the split the original prototype modeled (Maya Patel = "Jags Admin", Priya Nair/Ravi Kapoor
= "Senior Inspector") but the real build hadn't implemented yet. It now does, via a `staff_role`
column (`admin` / `inspector`) on top of the existing `is_jags_staff` flag:

| Capability | JAGS Admin | JAGS Inspector |
|---|---|---|
| Platform Home (billing, module licensing) | ✅ | ❌ (redirected straight into QMP Inspect) |
| Create a new project | ✅ | ❌ (no "+ New project" button; direct URL redirects away) |
| Numbering & Engagement Mode settings | ✅ | ❌ (nav link hidden; direct URL redirects to dashboard) |
| Approve/reject a Master ITP Library proposal | ✅ | ❌ (sees "Awaiting review by a JAGS Admin" instead of the buttons) |
| Manage staff access grants (Staff Access screen) | ✅ | ❌ (nav link hidden; direct URL redirects to dashboard) |
| Propose an ITP *to* the Master Library | ✅ | ✅ |
| Create/edit ITPs, activities, checklists, run field inspections | ✅ | ✅ |
| Raise/close NCRs, Standalone/FAT assignments | ✅ | ✅ |
| Notify / Sign off / Proceed on the intervention grid | ✅ | ✅ |

The existing `admin@jagsassurance.local` account predates this column (`staff_role` is `NULL` for
it) and is treated as admin-equivalent, so nothing about it changed. See step 15 below for how to
actually test this split.

### The dashboard is now genuinely role-based, not one shared screen

Until this pass, every login — JAGS staff or external party — landed on an identical "Inspector
Dashboard" with hardcoded zeros (a Phase 0 placeholder that was never replaced). It now shows real,
RLS-scoped numbers and a heading/panel that differ by who's logged in:

| Login | Heading | Extra panel |
|---|---|---|
| JAGS Admin | "JAGS Admin Overview" | Master Library proposals awaiting review (only if any are pending) |
| JAGS Inspector | "Inspector Dashboard" | Awaiting your sign-off (only if linked to a `project_parties` row) |
| Client | "{Client org name} Dashboard" | ITPs awaiting your acceptance |
| Subcontractor / Main contractor / TPI-lab | "{Party name} Dashboard" | Awaiting your sign-off |

The four stat cards (Active projects / Active ITPs / Inspections in progress / Open NCRs) are real
counts for everyone, scoped by RLS to whatever that login can actually see — not the same fixed
numbers regardless of role. Quickly confirm this by logging in as `client@meridian.demo` (see the
acceptance panel) and then `contractor@gfl.demo` (see the sign-off panel instead) back to back.

## 3. The demo data already in your database

- **Organisations**: Meridian Energy (co-branded) and Northgate Industries (JAGS-led) — the second
  org exists purely to prove staff-scoping actually isolates: `inspector.scoped@jagsassurance.local`
  is granted Meridian only and should never see Northgate anywhere, including in the plain "Your
  organisations" list on the dashboard.
- **Projects**: `MER-2026-001` (Substation Bldg 2 Electrical Upgrade, active) and `MER-2026-002`
  (LV Switchroom Refurbishment, draft), both under Meridian Energy. Northgate Industries
  deliberately has no projects yet — it exists only for the isolation check above.
- **Project parties on MER-2026-001**: Voltway Electrical Ltd (subcontractor), GFL Engineering &
  Construction (main contractor), Bureau Veritas (TPI/lab), JAGS Assurance, Meridian Energy (client)
- A worked example already exists: ITP `MER-JAGS-ITP-001` → checklist → a completed inspection →
  an issued IRN, plus an NCR and a punch list item, so several pages won't be empty on first look.

You don't need to delete or reset any of this — it's meant to be poked at.

## 4. The core loop: ITP → Checklist → Inspection → IRN

This is the single most important thing to test — it's the whole point of the app.

1. Log in as **admin**. You land on the **Platform Home** (the Orbit hub) — only **QMP Inspect** is
   "Active"; every other module shows "Not enabled" — that's correct, only Inspect is built.
2. Click **Open module →** on QMP Inspect. You're now inside the module (sidebar changes to
   Dashboard/Projects/ITPs/etc.).
3. Go to **ITPs** in the sidebar → **+ New ITP**. You'll see three tabs:
   - **Build from scratch** — fill in Project, ITP number (any format, e.g. `MER-JAGS-ITP-020`),
     Title, Applicable standard → **Create ITP**. You land on the new ITP with 4 default sections
     already created (Submittals & Materials / Installation-Execution / Testing & Commissioning /
     Handover).
   - **Start from a master template** — only shows templates that exist in the Master ITP Library
     (empty until you've approved a proposal there — see step 9).
   - **Generate from a spec description** — paste any text, click Generate. **On your current free
     Gemini tier this will show "AI assistance is not available in this environment yet" — that's
     correct, expected behavior**, not a bug (see step 10 for why).
4. On the ITP page, click **+ Add activity** under any section: item number (e.g. `1.1`), activity
   text, acceptance criteria, evidence type (leave as "Checklist"), discipline (optional — try
   picking one, e.g. ELE).
5. Once you have at least one activity, set an **intervention level** (H/W/R/S) for one or two of
   the party columns (Meridian Energy, JAGS Assurance, GFL, Voltway, Bureau Veritas) by picking from
   the dropdown in that cell. A small status badge appears under it once you do.
   - Pick **H** (Hold) for one party → click **Notify** → click **Sign off**. Watch it go
     Pending → Notified → Signed off.
   - Pick **W** (Witness) for another party → click **Notify**. You'll see only "Sign off" offered —
     **"Proceed" only appears once the configured notice period (24h by default) has actually
     passed** — this is deliberate, a Witness point is allowed to auto-proceed after a wait, a Hold
     never can.
6. Click **Submit for review** → then **Approve**. Status badge moves Draft → Under review →
   Approved.
7. Click **Checklists →** (top right). Click **Generate checklists** — this creates a numbered
   checklist for every "Checklist"-type activity (R48: only happens at approval, never before).
8. Click **Open →** on the generated checklist. Fill in a location (optional) → **Start inspection**.
   You now see the field-execution screen: big Yes/No/N-A buttons per item, a comment box, photo
   upload, and (if the activity's wording mentions something like "calibration"/"weld"/"material"/
   "submittal") a register-verification banner — see step 11 for that specifically.
9. Answer every item, sign in the signature box (click-drag with your mouse), optionally add notes,
   click **Complete inspection**. You land on the Inspection Record page showing the result
   (pass/fail/partial) and a "View checklist →" link back.
10. If the result is **pass**, click **Issue IRN** — a formal release number gets stamped
    (`{ITP}-IRN-{n}`).
11. If the result is **fail**, go check the project's **Punch List** (see step 7 below) — a punch
    item should have appeared automatically, source "Inspection failure".

## 5. NCRs

1. Sidebar → **NCRs** → **+ Raise NCR**.
2. Pick a project, severity (Observation / Minor NCR / Major NCR), description. Notice the
   **"Draft with AI"** panel above the description — same free-tier gate message as the ITP one.
3. Submit. You land on the NCR detail page (number auto-generated like `MER-2026-001-JAGS-NCR-002`; the format comes from Settings > Numbering).
   Check the **Punch List** for that project — the NCR should have created a matching punch item
   automatically (source "NCR").
4. Try clicking **Close NCR** immediately — it should refuse with "Root cause, corrective action
   and verification notes are required before closing." Fill those three fields in, then close it
   successfully. Check the punch list again — the matching item should now show **closed** too
   (closing an NCR closes its punch item automatically, reusing the same verification notes).
5. Sidebar → **NCRs** (the register) — you should see stat cards (Total/Open/Overdue/Closed) and
   your new row with a severity badge.

## 6. Standalone / FAT assignments

Use this for a one-off test/inspection that isn't tied to a full ITP (the client's own example:
"a FAT on a crusher").

1. Sidebar → **Standalone Assignments** → **+ New assignment**.
2. Pick a project, an assignment type (FAT / Witness Inspection / Specific Test / Pre-Shipment),
   equipment description → **Create assignment**.
3. On the assignment page, try each tab: **Measurements** (add a row, mark pass/fail),
   **Photos** (upload — needs the `inspection-evidence` Storage bucket, already created),
   **Punch List** (assignment-scoped, separate from the project-wide one), **Witness Signatures**,
   **Notes**.
4. At the bottom, pick a **Conclusion** and click **Finalize assignment**. **A browser confirmation
   popup will appear ("Finalizing records the conclusion... Continue?") — click OK.** Once
   finalized, all the edit forms disappear and it becomes read-only.
5. If you picked **Conditional Pass**, check the project's Punch List — a matching item should
   appear automatically (source "FAT conditional pass").

## 7. Project-wide Punch List, Data Book, and Handover

These are reached from a project, not the top-level sidebar — go directly to the URL pattern
`/inspect/projects/<project-id>/...` (the project IDs for your two seed projects are
`c0000000-0000-0000-0000-000000000001` for MER-2026-001 and `...002` for MER-2026-002), or click
through from wherever a punch item/data-book link already appears (e.g. the KPI page below).

1. **Punch List** (`/punch-list`): shows every open/closed item across sources (manual, inspection
   failure, FAT conditional pass, NCR, walkdown). Try **+ Add punch item** manually, then **Close**
   it — closing requires a "closing evidence" note, same pattern as NCR close-out.
2. **Data Book** (`/data-book`): shows a readiness percentage per category (ITPs approved, IRNs
   issued, NCRs closed, open punch items). It won't reach 100% until everything is genuinely done —
   that's intentional (R86). Try **+ New Data Book**; the "Compile" action will refuse unless
   readiness is 100% and the punch list is clear, unless a JAGS Admin ticks the override box (Admin only, with a written reason) and
   give a reason (R87 — a deliberate, logged exception, not a silent bypass).
3. **Handover** (sidebar link, top-level): once a Data Book is compiled and issued, it shows up here
   for the client to see and acknowledge receipt of.

## 8. Document Vault

1. Sidebar → **Document Vault**. Pick a project from the dropdown at top.
2. You'll see all 11 fixed folders (Drawings, Specifications, Standards & Codes, Material
   Submittals, RFIs, Method Statements, ITPs (Approved), Checklists & Forms, Approvals &
   Correspondence, Certificates, General Reference) with document counts.
3. Click into one, e.g. Drawings → **Upload document**: title, revision, pick a file, notes →
   Upload. Upload a second file with the **same "Revision key"** as the first — the old one should
   flip to "superseded" instead of disappearing (controlled-document behavior: nothing gets deleted).

## 9. Master ITP Library (staff-only)

This is JAGS's own internal library — never visible to a client login, at any level.

1. Sidebar → **Master ITP Library** — empty until you approve a proposal.
2. Go to an ITP that's **Approved** or **Client accepted** (e.g. `MER-JAGS-ITP-001`) → click
   **Propose to master library** → choose "New master template", give it a title → Submit proposal.
3. Sidebar → Master ITP Library → **Review proposals →** → **Approve**. The template now appears in
   the library with its sections/items copied in.
4. Go back to **+ New ITP** → **Start from a master template** tab — your new template should be
   selectable. Pick it, fill in project/number/title → **Create ITP from template**. Its sections
   and activities should match the source ITP.

## 10. Numbering & Engagement Mode (staff-only)

Sidebar → **Numbering**. Pick an organisation (Meridian Energy). You can set the **engagement
mode** (JAGS-led / Co-branded / White-label — this drives both branding and how document numbers
are formatted) and, per document type (ITP/NCR/checklist/IRN/standalone assignment/vault document),
a custom numbering format (client code, originator code, separator, padding, whether to include the
year). Leave everything unconfigured and numbers still generate fine using a sensible default
format — configuring this is optional, not required for the app to work.

## 11. Registers & auto-verification (the "soft-stop" feature)

1. Go to a project's **Registers** page (`/inspect/projects/<id>/registers`) — three sections:
   Calibration, Welder Qualification, Material. Try adding a row to each.
2. Now go start (or re-open a draft) inspection on a checklist whose activity wording mentions
   something like "submittal" or "calibration" or "weld". You'll see a small banner appear above
   that item:
   - **Blue/info banner** — a matching, valid register entry was found; shows a one-line summary.
   - **Amber/warning banner** — no matching entry (or an expired one) was found. **The Yes/No/N-A
     buttons for that item are disabled until you type a reason in the box that appears** — this is
     the "soft-stop": it never blocks the inspection outright, it just requires you to explicitly
     acknowledge why you're proceeding anyway. Type any reason and watch the buttons unlock.

## 12. Client KPI dashboard

Go to `/inspect/projects/<id>/kpis` for either project. You'll see six stat cards (first-time pass
rate, hold-point turnaround, NCR close-out time, data-book readiness, inspections completed vs
planned, ITP completion %) computed live from whatever data exists on that project, plus an "open
items" table (open NCRs + failed inspections). Numbers should visibly change as you do the things
in the sections above (e.g. completing another inspection changes the completion ratio).

## 13. Confirming tenant isolation (do this last)

1. Sign out (bottom of the sidebar) and log back in as **client@meridian.demo** / `DemoPass123!`.
2. You should land **directly on the QMP Inspect dashboard** — no Platform Home, no "← JAGS
   Assurance" link in the sidebar, and no staff-only nav items (Master ITP Library, Numbering
   should be missing entirely).
3. Everything you see should be scoped to Meridian Energy only — try navigating directly to a URL
   for a project/ITP and confirm you can still only ever see Meridian Energy's own data (there's
   only one organisation in the demo data right now, so this mostly confirms the *staff-only*
   restrictions rather than cross-tenant isolation — a second organisation would be needed to see
   isolation between two different clients, which the RLS policies already enforce at the database
   level regardless).
4. Try visiting a staff-only page directly as the client user, e.g. `/inspect/itp-master` — you
   should be redirected away, not shown an error or the actual content.

## 14. AI features on your free tier — what to expect

You're on `AI_TIER=free` in `apps/web/.env.local`, which is correct for now. Every AI-touching
screen (NCR "Draft with AI", ITP "Generate from a spec description", the checklist's "Check for
inconsistencies" button) will show a plain message explaining AI isn't available yet, instead of
crashing or silently doing nothing. **This is intentional** — Google's free tier terms allow
training on submitted data, so the app refuses to send any real project content on this tier by
design. When you're ready to actually use the AI features, you'll need: (a) a paid Gemini API key,
(b) `AI_TIER=paid` in the environment, and (c) the specific organisation's `ai_consent` flag set to
true (currently only settable directly in the database — there's no admin UI toggle for it yet).

## 15. JAGS Admin vs JAGS Inspector

1. Log in as `inspector@jagsassurance.local`. You should land **directly on the QMP Inspect
   dashboard** (Inspector Dashboard) — not Platform Home. The sidebar shows "JAGS Inspector" under
   your name, and there is no "← JAGS Assurance" link, no **Master ITP Library**, and no
   **Numbering** nav item — compare this to logging in as `admin@jagsassurance.local`, which shows
   all of those.
2. Go to **Projects** — there is no **+ New project** button (the admin account has one). Try
   navigating directly to `/inspect/projects/new` anyway — you're redirected back to the projects
   list, not shown the form.
3. Try navigating directly to `/inspect/organisation/numbering` — redirected to the dashboard. `/inspect/settings` does open for an Inspector, but only the view-only **Client Teams** and **Teams** sections (no admin sections). The Master ITP Library is hidden from the menu but its address still opens (proposals are review-only).
4. Try navigating directly to `/platform` — redirected to the dashboard, not shown the Orbit hub.
5. Confirm the inspector *can* still do the operational work: open **ITPs** → **+ New ITP** is
   there, you can add activities, generate checklists, run a field inspection, raise an NCR, and
   Notify/Sign off on the intervention grid exactly as the admin account can.
6. Propose an approved ITP to the Master Library (inspector-allowed) — go to **Master ITP Library**
   → wait, that link is hidden for the inspector, so instead open an approved ITP directly (e.g.
   `MER-JAGS-ITP-001`) and use its **Propose to master library** button, which is still available.
   Then log back in as `admin@jagsassurance.local` and go to **Master ITP Library → Review
   proposals →** to approve it — the inspector could submit the proposal but only the admin can
   approve it (logging back in as the inspector and visiting `/inspect/itp-master/proposals`
   directly shows the pending proposal with "Awaiting review by a JAGS Admin" instead of
   Approve/Reject buttons).

## 16. Scoped staff access (Staff Access screen)

Every JAGS staff account needs an `access_grants` row to see any client at all — by default a new
staff account is **global** (every organisation), same as `admin@jagsassurance.local` and
`inspector@jagsassurance.local`. An admin can narrow a specific inspector to just the clients they
actually work with, via a real settings screen rather than a one-off script.

1. Log in as `admin@jagsassurance.local` → sidebar → **Staff Access**. You should see all three
   JAGS staff accounts, each with their current grant(s): the two global ones show "Global — every
   client"; `Devika Rao` (inspector.scoped@jagsassurance.local) shows only "Meridian Energy".
2. Try the reverse first: log in as `inspector@jagsassurance.local` (a global inspector, not an
   admin) and try to visit `/inspect/organisation/staff-access` directly — you're redirected to the
   dashboard, and there's no **Staff Access** nav link either.
3. Back as admin, use the **+ Add grant** form to grant any staff member an **Organisation**-scoped
   or **Project**-scoped grant, then use **Remove** on a grant you no longer want — both are real
   database writes (try reloading the page after either action to confirm it persisted).
4. The actual isolation this produces: log in as `inspector.scoped@jagsassurance.local` (Devika
   Rao). The "Your organisations" list is on the admin dashboard only; for Devika, the organisation filter on **Projects** shows **only Meridian Energy** — Northgate
   Industries never appears, anywhere, even though it exists in the database (see section 3). She
   can still fully create/edit ITPs, activities, checklists, and everything else within Meridian —
   the scoping restricts *which clients*, not *what she can do* once inside one.
5. If a second organisation ever gets its own project, the same scoped inspector should be unable
   to open it by guessing its URL either — RLS enforces this at the database layer (see
   `supabase/migrations/20260910090000_phase3_scoped_staff_writes.sql` and
   `20260910100000_phase3_fix_organizations_write_select_leak.sql`), not just by hiding the link.

## 17. Per-party sign-off restriction (test each of the four non-staff logins)

This is the rule that a party's sign-off is theirs to give, not anyone's on the project — JAGS
staff can always countersign on a party's behalf, but an external login can only sign off the one
`project_parties` row it's linked to.

1. Log in as `subcontractor@voltway.demo`. Open ITP `MER-JAGS-ITP-001`
   (ITPs → `MER-JAGS-ITP-001`). Look at the intervention grid on item 1.1:
   - On the **Voltway Electrical Ltd** column, a pending/notified H or W shows a working
     **Sign off** button.
   - On every *other* party's column (Meridian Energy, JAGS Assurance, GFL, Bureau Veritas), a
     pending/notified cell shows the text **"Awaiting party"** instead of a button — there is no
     way to sign off on someone else's behalf from this login.
2. Sign off Voltway's own cell — the badge should flip from Notified/Pending straight to
   **Signed off**, and it should persist after a page reload (this is a real database write, not
   just local UI state).
3. Sign out, then repeat the same check logged in as `contractor@gfl.demo` (should only be able to
   sign off the **GFL Engineering & Construction** column) and `tpi@bureauveritas.demo` (only
   **Bureau Veritas**). `client@meridian.demo` can be checked the same way against the
   **Meridian Energy** column.
4. Log back in as `admin@jagsassurance.local` and confirm staff can still sign off **any** party's
   column — the restriction only applies to non-staff logins.

## 18. If something looks broken

- Check the terminal running `pnpm dev` for a stack trace — most real errors show up there even if
  the browser just shows a generic "This page couldn't load."
- A blank/empty state (e.g. "No ITPs yet") is usually correct, not a bug — check section 3 above for
  what data actually exists.
- If a page 500s in a way that doesn't match anything in this guide, that's worth reporting back —
  screenshot the terminal output, not just the browser error page.
