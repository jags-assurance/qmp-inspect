# Full project testing guide — every perspective, start to finish

This is a from-scratch walkthrough: build one brand-new organisation and project, run it through
the entire lifecycle, then repeat key steps logged in as every other role so you see the same
project from each side. It supersedes `MANUAL_TESTING_GUIDE.md` and
`COMPLETE_PROJECT_LIFECYCLE_GUIDE.md` for anything that changed this session (MFA has been
**removed entirely** — ignore any older doc that mentions enrolling it) and adds everything built
since: Self-Managed client self-service, Client Teams, Custom Roles, the AI audit trail, AI
register extraction, material traceability, Conditional Handover, the expanded Data Book
completeness index, and the rebuilt document formats.

Run `pnpm dev` from the repo root and open **http://localhost:3000** before starting.

---

## 0. How to log in

There's one login screen for everyone — email + password, then the app decides what you see based
on your role and organisation, not a "login as client" toggle.

**Every account's password is `DemoPass123!`.**

| Email | Who | Role | Lands on |
|---|---|---|---|
| `admin@jagsassurance.local` | Oliver Bennett | **JAGS Admin** (global) | Platform Home |
| `inspector@jagsassurance.local` | Ravi Kapoor | **JAGS Inspector** (global) | QMP Inspect dashboard |
| `inspector.scoped@jagsassurance.local` | Devika Rao | **JAGS Inspector** (Meridian Energy only) | QMP Inspect dashboard |
| `client@meridian.demo` | Priya Nair | **Normal client** (`full_service`), Meridian Energy | QMP Inspect dashboard |
| `contractor@gfl.demo` | Maria Alvez | Main contractor, on MER-2026-001 | QMP Inspect dashboard |
| `subcontractor@voltway.demo` | Sam Rourke | Subcontractor, on MER-2026-001 | QMP Inspect dashboard |
| `tpi@bureauveritas.demo` | Tom Okafor | TPI/Lab, on MER-2026-001 | QMP Inspect dashboard |
| `client@coralbay.demo` | Priya Sharma | **Self-Managed client** (`engagement_scope = 'self_managed'`), Coral Bay Utilities, on `CBU-2026-001` | QMP Inspect dashboard, with a **Manage** nav item |

Only a JAGS Admin sees **Platform Home** (the module hub with "QMP Inspect" as the one active
module) — every other login goes straight into the module. Sign out from the bottom of the
sidebar at any point to switch accounts.

There really are only these two client types — controlled by one column,
`organizations.engagement_scope` (`full_service` default, or `self_managed`). Log in as each of
the two client accounts above back-to-back and compare: `client@meridian.demo` sees the ordinary
dashboard with no self-service org-admin links; `client@coralbay.demo` additionally sees **Manage**,
**Client Teams**, **Custom Roles**, **Numbering**, and **Brand Colors** in the sidebar, and can
build/submit its own ITP drafts without JAGS lifting a finger until Approve.

---

## PART A — Build a brand-new project as JAGS Admin (full-service)

Log in as `admin@jagsassurance.local`.

### A1. Create the organisation

Sidebar → **Client Organisations** → **+ New organisation**:

| Field | Value |
|---|---|
| Organisation name | `Northwind Fabrication` |
| Slug | `northwind` |
| Engagement mode | `JAGS-led` |
| Engagement scope | `Full-Managed / End-to-End Execution` (leave the default — this is the normal "JAGS runs it" model; Part C covers the Self-Managed alternative) |

Submit. You land on the new org's detail page.

### A2. Create the project

Sidebar → **Projects** → **+ New project**:

| Field | Value |
|---|---|
| Organisation | `Northwind Fabrication` |
| Project number | `NWF-2026-001` |
| Project name | `Tank Farm Piping Upgrade` |
| Site location | `Northwind Site, Bay 2` |

Submit. You land on the project detail page — note four sections already exist under **Project
parties**: none yet, add them next.

### A3. Add project parties

Still on the project page, **Project parties** section → **+ Add party**, one at a time:

| Party type | Organisation / company name | Contact name | Contact email |
|---|---|---|---|
| Client | `Northwind Fabrication` | — | — |
| Main Contractor | `Aegis Construction Group` | — | — |
| Subcontractor | `Delta Piping Services` | — | — |
| TPI / Lab | `Global Assurance Labs` | — | — |

Leave "Onboarded by" as `JAGS` (the default — this is JAGS creating the record on the parties'
behalf; Part C's self-managed client onboards its own parties differently).

### A4. Build the ITP

Sidebar → **ITPs** → **+ New ITP**. There are three ways in — try the manual one now, and the
AI one in Part D:

**Build from scratch:**

| Field | Value |
|---|---|
| Project | `NWF-2026-001 — Tank Farm Piping Upgrade` |
| ITP number | leave blank (auto-generated) |
| Title | `Tank Farm Piping Installation & Testing` |
| Applicable standard | `ASME B31.3` |

**Create ITP** → you land on the new ITP with 4 default sections (Submittals & Materials /
Installation-Execution / Testing & Commissioning / Handover).

Add at least one activity per section (**+ Add activity**):

| Section | Item | Activity | Acceptance criteria | Evidence type |
|---|---|---|---|---|
| 1 | 1.1 | Pipe material receiving inspection | Mill certs match approved spec; no transit damage | Checklist |
| 2 | 2.1 | Weld visual inspection | No visible cracks/undercut per AWS D1.1 | Checklist |
| 3 | 3.1 | Hydrostatic pressure test | Hold at 1.5× design pressure for 30 min, no visible leak | Measurement record |
| 4 | 4.1 | As-built and data-book review | As-builts match final installation; O&M manuals complete | Document upload |

### A5. Set intervention levels and notice periods

On item 2.1 (weld inspection), open the intervention grid and assign:

- **Aegis Construction Group** → `H` (Hold)
- **Delta Piping Services** → `W` (Witness)
- **Global Assurance Labs** → `H` (Hold)
- **Northwind Fabrication** (client) → `W` (Witness)

Click **Notify** on the Delta cell, then **Sign off**. Click **Notify** on the client's Witness
cell — only **Sign off** shows until the notice period (24h default) elapses; **Proceed** appears
automatically once it does. A Witness notice can also be waived *instead of* notified: while the Witness cell is still pending (before **Notify**), the checklist offers **Waive notice for this inspection** (written reason, at least 10 characters, kept on the audit trail). Once Notify has been clicked the waiver is no longer offered.

Leave Aegis's and Global Assurance Labs's **Hold** cells un-signed for now — A8 deliberately tries
to start the inspection while they're still open, to show the new Hold-blocks-work behaviour
before you clear them.

### A6. Submit for review → Approve

Top of the ITP page: **Submit for review** → then **Approve**. Status badge moves
Draft → Under review → Approved.

### A7. Generate checklists

**Checklists →** (top right) → **Generate checklists** — creates a numbered checklist for every
Checklist-type activity (only fires at approval, per R48).

### A8. Run the field inspection

Open the generated checklist for item 2.1 — with Aegis's and Global Assurance Labs's Hold cells
still open, there's no **Start inspection** button at all: a message reads *"This activity has an
open Hold — the assigned party must release it... before the inspection can start."* This is a
real requirement (R71: *"a hold point must wait"*) — a Hold now blocks the physical work itself,
not just the final paperwork, so field data can't even be entered until it's released.

Go back to the ITP page and **Sign off** both Hold cells (Aegis, Global Assurance Labs). Return to
the checklist — **Start inspection** now appears. Click it → answer every item Yes/No/N-A, add a
comment on at least one, sign in the signature box, **Complete inspection**.

Check the new **FIELD RESULT** banner on the resulting Inspection Record page (rebuilt this
session) — for a pass it reads *"FIELD RESULT: PASS..."*; for a fail it names the specific failing
item and quotes your own comment, not a generic message.

### A9. Issue IRN, or handle a fail

- **Pass** → **Issue IRN** — a formal release number is stamped (`{ITP}-IRN-{n}`).
- **Fail** → go to **NCRs** → **+ Raise NCR**, project `NWF-2026-001`, severity `Minor NCR`,
  description whatever the failing item was. Try **Close NCR** immediately — it refuses
  ("Root cause, corrective action and verification notes are required"). Fill those three fields,
  close it — check the project's **Punch List**, a matching item should now show **closed** too.

### A10. Registers

Project page → **Registers**. Add one row to each of Calibration, Welder Qualification, and
Material — note Material now has **heat/batch/PO/CoC-MTC** fields and a **Receiving inspection**
status (`Released` / `Quarantined — pending disposition` / `On hold`), added this session. Try
**Quarantined** with a disposition note — the row shows a warning badge in the table.

Then try **Extract from document text (AI-assisted)** on the Calibration register — paste:

```
Instrument: Fluke 87V multimeter. Certificate CAL-9001. Calibrated 01 Jan 2026. Next due 31 Dec 2026.
```

**Extract rows** → review the extracted row (editable), **Add 1 row**. This is a real Gemini call
(all demo orgs have `ai_consent = true`); the extraction never invents a field it isn't given.

### A11. Punch list

Project page → **Punch List** — shows every open/closed item across sources. **+ Add punch item**
manually, then **Close** it (requires a closing-evidence note).

### A12. Data Book

Project page → **Data Book** → **+ New Data Book**. The readiness panel now shows **8 categories**
(expanded this session): ITPs approved, inspection records with an IRN, completed checklists,
calibration/welder/material register readiness, NCRs closed, plus an informational "Handover
certificate issued" row that doesn't gate compilation. The overall % is one disclosed formula
(total provided ÷ total required across the 7 gating categories) shown right under the bar.

With something still outstanding, try **Compile Data Book** — it refuses. Check **Compile anyway
(override)** — this now shows the **actual open punch items and their due dates** before you
commit, not just a blank reason box. Fill in a reason, compile — the Data Book card shows
"Conditional — compiled with open items outstanding" plus the itemised list.

### A13. Handover

Once compiled, **Issue for handover**: certificate number, upload any file as the package. Go to
sidebar → **Handover** — the certificate shows a **Conditional** badge (if you overrode in A12)
with the same itemised open-items list, or a clean certificate if everything was actually closed.

---

## PART B — Same project, different login

### B1. JAGS Inspector

Log in as `inspector@jagsassurance.local`. Confirm: no Platform Home, no "← JAGS Assurance" link,
no **Master ITP Library** / **Numbering** nav items, no **+ New project** button. Confirm they
*can* still create ITPs, run inspections, raise NCRs, Notify/Sign off — inspectors do the
operational work, only admin-tier settings are blocked.

### B2. Client (Meridian Energy — an existing full-service org)

Log in as `client@meridian.demo`. Dashboard heading reads "Meridian Energy Dashboard" with an
"ITPs awaiting your acceptance" panel. Open an approved ITP and confirm the client can sign off
**only** the Meridian Energy column on the intervention grid — every other party's cell shows
"Awaiting party", not a working button.

### B3. Subcontractor / Main Contractor / TPI-Lab

Log in as `subcontractor@voltway.demo`, then `contractor@gfl.demo`, then `tpi@bureauveritas.demo`
in turn. Each can only sign off their own party's column, same restriction as B2. Log back in as
admin and confirm staff can sign off **any** column.

---

## PART C — Self-Managed client (the client runs their own program)

None of the seeded demo orgs are Self-Managed today — this part creates one, `Coral Bay Utilities`,
and runs a full sample project (`CBU-2026-001`, a subsea pipeline tie-in) through it end to end so
you can see exactly what a self-managed client's own team can and can't do at every stage.

**Important correction up front, before you test the ITP flow below:** ITP approval is **not** a
multi-party chain where each project party approves the document one by one in some order. The real
mechanism is three separate things that are easy to conflate:

1. **Approving the ITP document itself** (`draft → under_review → approved`) is a single action by
   one JAGS-authorised person. This stays **JAGS-staff-only even on a self-managed engagement** —
   `apps/web/app/inspect/itps/[id]/page.tsx` has this in a comment verbatim: *"Submitting for
   review, approving, and bulk-notifying stay JAGS-only actions regardless... approval authority
   always stays with JAGS even for a Self-Managed client."* It is never gated on how many/which
   parties have signed anything.
2. **`Client Accepted`** is a real 4th status, separate from `approved` — the client party's own
   linked user formally accepting what JAGS just certified. One click, one party, always *after*
   approval, never a substitute for it.
3. **The per-activity Hold/Witness/Review/Surveillance grid** (set in A5/C-below) is a wholly
   different mechanism from both of the above. It never gates the ITP document's own approval —
   it only matters later, once field checklists exist, where an open Hold blocks *that specific
   activity's* inspection from even **starting** (R71: "a hold point must wait" — this now holds
   the physical work itself, not just the finished paperwork). Witness/Review/Surveillance never
   block anything (notify-and-proceed). Two Hold parties on the same activity clear independently
   and in any order, not a fixed sequence.

### Cast for this sample project

| Actor | Party type | Who's logged in |
|---|---|---|
| Coral Bay Utilities | Client org, `engagement_scope = self_managed` | Priya Sharma — Coral Bay's own QA Lead |
| Aegis Marine Contractors | Main contractor | their own site rep |
| Delta Subsea Services | Subcontractor (does the actual welding) | their own site rep |
| Bureau Veritas | TPI / Lab (independent verifier) | their own inspector |
| JAGS Assurance | *not a project party at all* | a JAGS Inspector with org access |

That last row is deliberate: the self-managed client's own **Add project party** form
(`add-self-managed-party-form.tsx`) offers `client, main_contractor, subcontractor, tpi_lab, vendor`
— `jags` is not one of the options, and nothing auto-seeds a `jags` party row. JAGS doesn't need one
either — staff access comes from `access_grants`, not from being a party on the project. JAGS shows
up in this engagement purely as the independent approver, never as an operational participant.

### C1. The org (already exists — just log in)

`client@coralbay.demo` / `DemoPass123!` is a real, working login for **Coral Bay Utilities**
(`engagement_scope = self_managed`) with project `CBU-2026-001 — Subsea Tie-In Package 3` already
created and this user already linked as its `client` party — no setup needed, log straight in as
Priya Sharma. (If you want to build a second self-managed org from scratch instead: as admin,
**Client Organisations** → **+ New organisation** → engagement scope
**`Self-Managed / Platform-Only`**, add one **Client**-type party with a real login, same as any
other party.)

### C2. Log in as that client — same login, no JAGS step

Log in as `client@coralbay.demo`. Sidebar → **Projects** shows `CBU-2026-001` already there, and
**+ New project** is available directly to this client (no JAGS step in between) — the org picker
is restricted to Coral Bay Utilities only, and there's no "+ New organisation" link (self-managed
clients can't create other orgs). Try creating a second project to confirm this works end to end.

### C3. Onboard their own users onto the project

Open `CBU-2026-001` → **Project parties** → the client sees **"Add someone who already has a
JAGS Assurance account"** (a different, narrower form than JAGS Admin's — email lookup only, no
new-account creation) — add Aegis (main contractor), Delta (subcontractor), and Bureau Veritas
(TPI/lab) by email (reuse `contractor@gfl.demo`, `subcontractor@voltway.demo`,
`tpi@bureauveritas.demo` from Part A/B for a quick test).

### C3b. The Manage hub

Sidebar → **Manage** (only visible to a self-managed org's own non-staff login) — a consolidated
page: an action queue of exactly which of Coral Bay's own ITPs need Submit-for-review, Accept, or
Generate-checklists right now, a card per project linking to Parties/KPIs/Reports/Registers/Punch
List/Data Book, and org-settings shortcuts (Client Teams, Custom Roles, Numbering, Brand Colors).
Empty right now — it fills in as you work through C4 onward.

### C4. Priya builds the ITP draft herself

**ITPs → + New ITP → Generate from vault documents** (or build from scratch) — she's allowed to do
this while the ITP stays in `draft`, because `engagement_scope = self_managed` grants her the same
drafting rights JAGS staff normally have (`is_client_itp_creator()`). Add:

| Item | Activity | Acceptance criteria |
|---|---|---|
| 1.1 | Pipe spool material receiving | Mill certs match spec; no transit damage |
| 2.1 | Subsea weld visual + NDT | No cracks/undercut per AWS D1.1; NDT report accepted |
| 3.1 | Hydrostatic pressure test | 1.5× design pressure, 30 min hold, no leak |

On item 2.1, she sets the intervention grid herself: **Delta** → `H` (Hold, they're doing the
weld), **Aegis** → `W` (Witness), **Bureau Veritas** → `H` (Hold, independent NDT verification),
**Coral Bay** (client) → `W` (Witness). None of this requires anyone else's input yet — it's just
draft-state configuration, and if she used "Generate from vault documents" or a master-template
copy, checklists are *already generated* at this point, in draft (a bonus of those two creation
paths — the manual "Build from scratch" path needs the later, staff-only Generate-checklists button
instead, see C6).

### C5. Priya hands it to JAGS herself, JAGS's one required checkpoint remains

Still logged in as Priya, on the same ITP: **Submit for review** (`draft → under_review`) is now
a button she can click herself — a self-managed client's own eligible party can do this directly,
since it's a clerical hand-off, not a certification act. It's the same as her building the draft:
no new integrity risk, just one fewer JAGS round-trip. What she still **cannot** do is Approve.

Log in as a JAGS Inspector/Admin with access to Coral Bay Utilities — a notification is waiting for
them ("ITP submitted for review") — and click **Approve** (`under_review → approved`). This one
button stays JAGS-staff-only, with no self-managed bypass, ever: it's the one touchpoint that never
moves to the client's side no matter how much day-to-day work they self-manage.

### C6. Coral Bay accepts its own approved ITP, and can now generate its own checklists

Log back in as Priya. Now that the ITP is `approved`, an **Accept ITP** button appears (only for
the user linked to the `client` party — checked at the database level, not just the UI). Click it
→ `approved → client_accepted`. This is Coral Bay's own formal countersignature on what JAGS just
certified — a second, distinct approval, done by a different party for a different reason (JAGS
certifies technical correctness; the client accepts it as the asset owner).

If the ITP was built manually and still has no checklists, **Checklists → Generate checklists** is
now also self-service for the same eligible party — it's scaffolding on top of already-approved
activities, not a certification act, so there's no reason to keep routing it through JAGS. (Approve,
Close NCR, and Issue IRN are the only three actions that never become self-service, on any
engagement — see C9.)

### C7. Field execution — who executes, and the real per-party order

Because Coral Bay is self-managed, `client` is added to the set of party types allowed to physically
execute a checklist project-wide (normally only the contractor/subcontractor doing the work can
self-inspect) — Coral Bay's own people could run an inspection themselves, not just contractors.

For item 2.1, Delta's rep tries to open the checklist — there's no **Start inspection** button yet:
two Hold-type cells are still open (Bureau Veritas's Hold, and Delta's own Hold on its own work),
and a Hold now blocks the physical work from starting, not just the finished paperwork (R71: *"a
hold point must wait"*). Aegis's Witness cell doesn't block anything — it just needs Notify →
Sign off, or it auto-clears after the 24h notice period if they don't attend.

Delta and Bureau Veritas sign off their own Hold cells (**there is no required order between
them** — whichever finishes reviewing first signs first). Once both clear, **Start inspection**
appears for Delta's rep, who then answers every line, adds photos, and signs.

### C8. Pass or fail

- **Pass** → **Issue IRN**. Issuing an IRN and closing an NCR are two of the three
  assurance-critical permissions that stay JAGS-Admin-grantable-only even on a self-managed
  engagement (see C10) — Coral Bay's default client user can raise an NCR but can't self-certify
  closing one or releasing an IRN unless JAGS Admin has explicitly delegated that permission to a
  named role.
- **Fail** → an NCR gets raised against item 2.1, linked to a punch-list item, and follows the same
  CAPA → verify → close pattern as Part A.

From here, registers, punch list, and the Data Book/Conditional Handover all work exactly as in
Part A.

### C9. Dashboards & reports — what's actually different for self-managed (answer: almost nothing)

It's tempting to assume a self-managed client gets a richer dashboard/reports surface since they're
running so much of the project themselves — checked against the code, that's not the case. There is
one shared client-facing dashboard and one shared set of report/analytics features across the whole
app, gated by role and RLS, never by `engagement_scope`. Log in as Priya and confirm:

| Feature | Coral Bay (self-managed client) gets it? |
|---|---|
| Client dashboard (stat cards, sign-off queue, NCRs assigned, quick links) | **Yes** — the exact same `ExternalPartyDashboard` every client role sees |
| Project KPIs ("Quality performance": first-time pass rate, hold-point turnaround, NCR close-out, data-book readiness, quality by party/discipline, trends) | **Yes**, full view — the code literally calls this the client-facing KPI dashboard |
| Reports page (ITP PDFs, inspection reports, NCR close-out) | **Yes**, viewing/downloading. **Monthly/weekly report packs are JAGS-staff only** (the `background_jobs` read policy requires staff), so a client does not see them |
| Registers (calibration, welder, material — incl. AI extraction) | **Yes**, no staff gate |
| Punch list | **Yes**, RLS-scoped |
| Data Book | **View only** — Create/Compile/Issue Conditional Handover stays JAGS-staff-only, same as any client |
| Admin dashboard (org-wide portfolio across every project) | **No** — JAGS admin-staff only, always |
| Power BI reporting page (raw SQL views) | **No** — admin-staff only; clients of any kind never get this page (and the monthly report packs are JAGS-only too) |

So the one real takeaway: self-managed changes *who builds and executes the work*, not *who sees
the numbers*. A self-managed client was already getting the same generous dashboard/KPI/reports/
registers access as any full-service client — nothing there needed to be, or was, specially opened
up for `self_managed`.

### C10. Create their own Client Team

Sidebar → **Client Teams** → create a team, assign it to the project, add themselves as the first
member/lead (the bootstrap-fix logic lets the very first member self-assign as lead).

### C11. Define and assign a Custom Role

Sidebar → **Custom Roles** → **+ New role**, e.g. `Site QA Lead`. Toggle on `add_project_party` and
`view_org_reports` — try toggling `close_ncr` or `issue_irn`: these three assurance-critical
permissions stay **JAGS-Admin-only even for a self-managed org's own role**, by design (a client
must never be able to self-certify its own release/closure decisions — the same principle from C6
and C8). Assign the role to a user.

### C12. Branding and numbering

Sidebar → **Brand Colors** and **Numbering** — both now self-service for this org (scoped to their
own org only, no picker) — change the accent color and a document-numbering format, then check a
generated PDF picks it up.

---

## PART D — AI features end to end

All demo orgs have `ai_consent = true`, so every AI button below makes a real Gemini call and logs
a real audit-trail row (`ai_usage_log` — model, prompt version, source reference, and the raw
response, plus who reviewed it and what they changed, once you submit).

### D1. AI-drafted ITP, multi-discipline

Upload a real spec or method statement to the project's **Document Vault** (any "Specifications" or
"Method Statements" folder) — a PDF or .docx with genuine inspection-relevant content works best.
**ITPs → + New ITP → Generate from vault documents**, pick the project, check the uploaded
document(s), set depth to "Detailed", **Generate draft**. Review every activity's reference —
it should now cite the source document's own number/revision alongside the clause (e.g.
`ABC-123 Rev 00, 4.2`), not a bare clause number, and correctly split activities across
disciplines if your source spans more than one trade.

### D2. AI-drafted NCR

**NCRs → + Raise NCR** → type factual field notes into the notes box → **Draft with AI** → review
the drafted description/requirement, edit if you like, submit. On the NCR's close-out form, try
**Suggest root cause (AI)** the same way.

### D3. AI-drafted report narrative

On a completed Inspection Record (or a Standalone/FAT assignment), find **Report conclusion /
narrative** → **Draft with AI** → edit → **Save narrative**. This text becomes the PDF's conclusion
next time you regenerate it.

### D4. AI register extraction

Already covered in A10 — repeat on the Welder and Material registers with realistic pasted text to
see the "never invent a missing field" behaviour on incomplete source text (e.g. a welder record
missing a qualification range should come back with that field blank, not guessed).

---

## PART E — Documents to check (rebuilt this session)

1. **ITP PDF** (on any approved ITP → **Generate PDF**) — header reads "JAGS ASSURANCE / QMP
   INSPECT", page numbers in the footer, a document-identity line under the title, and a compact
   per-party intervention notation (`C:H SC:W JA:R CL:W`-style chips) with a party-code legend.
2. **Inspection Report PDF** — a Traceability table (Location / Drawing-specification / Inspection
   date-inspector) and a highlighted FIELD RESULT banner citing the specific reason.
3. **NCR PDF** (new this session — open any NCR → **Generate PDF**) — a Finding table and a
   separate Close-out table, both always present even before closure.

---

## Wrap-up checklist

- [ ] Logged in as all 7 seeded accounts at least once
- [ ] Built one project from scratch: org → project → 4 parties → ITP → intervention grid →
      approve → checklist → field inspection → IRN
- [ ] Raised, CAPA'd, and closed one NCR with automatic punch-list linkage
- [ ] Added rows to all three registers, including one AI extraction with a deliberately
      incomplete source (confirm the missing field stayed blank)
- [ ] Compiled a Data Book with an override, confirmed the itemised open-items list appears on
      both the Data Book page and the Handover Portal certificate
- [ ] Tested per-party sign-off restriction on all four non-staff roles
- [ ] Created a Self-Managed org and, logged in as its client, built an ITP draft themselves,
      confirmed Submit-for-review/Approve stayed JAGS-staff-only, then Accepted the approved ITP
      as the client and ran field execution through a Hold-point sign-off
- [ ] Confirmed the self-managed client's dashboard, KPIs, reports, and registers access matches a
      full-service client exactly — and that the admin dashboard and Power BI page stayed
      staff-only
- [ ] Onboarded a party, made a Client Team, defined a Custom Role, and confirmed the 3
      assurance-critical permissions (close_ncr, issue_irn, and approval) stayed admin-only
- [ ] Ran all 4 AI features and confirmed the audit trail (ask your Supabase project owner to spot
      check `ai_usage_log` if you want to see the raw captured response)
- [ ] Opened all 3 rebuilt PDF types and confirmed the new format elements

If anything above behaves differently from what's described, that's a real bug to report — every
step in this guide was checked against this session's actual, committed code and, where noted,
against a live run in the real application.
