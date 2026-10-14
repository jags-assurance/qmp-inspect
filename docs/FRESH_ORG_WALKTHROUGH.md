# Fresh client walkthrough — organisation → project → close-out

This is a from-zero test: nothing here reuses the seed data (Meridian Energy, Atlas
Manufacturing, Northgate Industries). Every step gives you the exact values to type so the
whole loop is reproducible. Follow it in order — each step depends on the one before it.

Log in as the JAGS Admin account for all of this: `admin@jagsassurance.local` / `DemoPass123!`
(see `docs/MANUAL_TESTING_GUIDE.md` for the full account list).

---

## 1. Create the client organisation

Sidebar → **Client Organisations** → fill in the form:

| Field | Value |
|---|---|
| Organisation name | `Riverside Fabrication Works` |
| Slug | leave blank (auto-derives to `riverside-fabrication-works`) |
| Engagement mode | `JAGS-led` |

Click **Create organisation**. It appears immediately in the list below the form, with "0
projects" and "No AI consent".

## 2. Create the project

Sidebar → **Projects** → **+ New project** (or use the **+ New organisation** shortcut's
sibling link right on that page):

| Field | Value |
|---|---|
| Client organisation | `Riverside Fabrication Works` (just created) |
| Project number | `RFW-2026-001` |
| Project name | `Workshop Crane Refurbishment` |
| Site location | `Riverside Site, Bay 3` |

Click **Create project**. You land on the projects list — click through to the new project.

## 3. Add project parties

On the project detail page, scroll to **Project parties** → use the **+ Add party** form at
the bottom (admin-only). Add these four, one at a time:

| Party type | Organisation / company name | Contact name | Contact email |
|---|---|---|---|
| JAGS Assurance | `JAGS Assurance` | `Oliver Bennett` | `admin@jagsassurance.local` |
| Client | `Riverside Fabrication Works` | `Dana Cole` | `dana.cole@riverside.example` |
| Main Contractor | `Crestline Construction` | `Marcus Webb` | `marcus.webb@crestline.example` |
| Subcontractor | `Ironhold Welding Services` | `Priya Shah` | `priya.shah@ironhold.example` |

Each one appears in the list immediately after submitting. These four are what the ITP's
intervention grid (H/W/R/S columns) will show once you create an ITP on this project.

## 4. Create the ITP

Sidebar → **ITPs** → **+ New ITP** → **Build from scratch** tab (the most deterministic path —
the other two tabs, master-template and AI-from-vault-documents, are covered as optional extras
in step 9 below):

| Field | Value |
|---|---|
| Project | `RFW-2026-001 — Workshop Crane Refurbishment` |
| ITP number | leave blank (auto-generates, e.g. `RFW-JAGS-ITP-001`) |
| Title | `Overhead Crane Structural & Electrical Refurbishment` |
| Applicable standard | `IEC 60204-32` |

Click **Create ITP**. You land on the ITP page with 4 default sections already created
(Submittals & Materials / Installation-Execution / Testing & Commissioning / Handover).

## 5. Add activities

Under **1. Submittals & Materials**, click **+ Add activity**:

| Field | Value |
|---|---|
| Item no. | `1.1` |
| Activity | `Verify crane hoist motor nameplate rating against approved submittal` |
| Acceptance criteria | `Matches approved motor submittal RFW-MAT-001` |
| Evidence | `Checklist` |
| Discipline | `MEC — Mechanical` |

Under **3. Testing & Commissioning**, add a second one:

| Field | Value |
|---|---|
| Item no. | `3.1` |
| Activity | `Load test the crane hoist at 110% rated capacity` |
| Acceptance criteria | `No permanent deformation, brake holds load for 10 minutes` |
| Evidence | `Checklist` |
| Discipline | `MEC — Mechanical` |

## 6. Set intervention levels

On item **1.1**'s row, use the dropdown under the **Ironhold Welding Services** column and
pick **H** (Hold) → click **Notify** → click **Sign off**. Then on the **Crestline
Construction** column, pick **W** (Witness) → click **Notify** (Proceed only appears after
the 24h notice period — that's expected, not a bug. To skip the notice instead, use **Waive notice
for this inspection** on the checklist *before* clicking Notify).

## 7. Approve the ITP

Click **Submit for review**, then **Approve**. Status badge moves Draft → Under review →
Approved.

## 8. Generate the checklist

Click **Checklists →** (top right) → **Generate checklists**. This creates a numbered
checklist for both "Checklist"-type activities (only allowed once approved, on this manual
"build from scratch" path — see `docs/MANUAL_TESTING_GUIDE.md` section 4 for why; the two
"generate the whole ITP" paths in step 9 below auto-generate checklists immediately instead).

## 9. Run a field inspection

Open the checklist for item **1.1** → fill in a location (optional) → **Start inspection**.
Answer the checklist item **Yes**, add an optional note (`Nameplate matches submittal RFW-MAT-001`),
sign in the signature box (click-drag), click **Complete inspection**. Result: **pass**.

Click **Issue IRN** — a formal release number is stamped (`RFW-JAGS-ITP-001-IRN-1`).

## 10. Raise and close an NCR

Sidebar → **NCRs** → **+ Raise NCR**:

| Field | Value |
|---|---|
| Project | `RFW-2026-001` |
| Severity | `Minor NCR` |
| Description | `Hoist brake pad showing early wear during load test — within tolerance but flagged for monitoring.` |

Submit. Check the project's **Punch List** — a matching item should have appeared
automatically (source "NCR"). Back on the NCR, fill in and submit:

| Field | Value |
|---|---|
| Root cause | `Brake pad material batch variance — confirmed with supplier certificate.` |
| Corrective action | `Replaced brake pad with certified batch; re-tested load holding at 110% capacity, passed.` |
| Verification notes | `Re-test observed by JAGS Inspector on 2026-09-15, brake held load for 10 minutes with no slip.` |

Click **Close NCR**. Check the punch list again — the matching item should now show closed too.

## 11. Punch list, data book, handover

- Project detail page → **Punch List**: confirm the NCR-sourced item shows closed.
- **Data Book**: readiness % should now reflect the one approved ITP / issued IRN / closed NCR.
  Try **+ New Data Book**, then **Compile** — it will refuse if anything is still open (by
  design, R86); once the punch list is clear, it should compile successfully.
- **Handover**: once compiled and issued, it appears here for the client to acknowledge.

## 12. Client KPIs

Project detail page → **Client KPIs**: first-time pass rate should show 100% (one inspection,
passed first time), NCR close-out time should show a real number, data-book readiness should
reflect step 11.

---

## Optional: the two other ITP-creation paths

Steps 4–8 above used **Build from scratch**, deliberately, because it's fully deterministic —
no AI dependency. Two other paths exist and are worth trying separately, on a second ITP:

### A. Generate from vault documents (AI-assisted)

This needs your Supabase org to have `AI_TIER=paid` **and** that org's `ai_consent` flag set
to `true` (currently only settable directly in the database — no UI toggle yet). On the free
dev tier it will correctly refuse with "AI assistance is not available in this environment
yet" — that's expected, not a bug.

If/when you do have a paid tier:
1. Sidebar → **Document Vault** → pick `Workshop Crane Refurbishment` → any folder (e.g.
   **Specifications**) → **Upload document**. Use the attached sample file
   `sample-lv-switchroom-spec.txt` (synthetic test content, safe to use on any tier) — title
   it `LV Switchroom Spec (test)`, revision `A`.
2. Wait a few seconds for text extraction to finish (status flips to "Ready").
3. **+ New ITP** → **Generate from vault documents** → pick the project → check the uploaded
   document → **Generate draft**. Review every generated section/activity, edit anything,
   then **Create ITP from this draft** — its checklist is generated immediately, no approval
   needed first (this is the automation you asked about earlier).

### B. Start from a master template

Only available once at least one template exists in **Master ITP Library** (staff-only,
sidebar). To create one: open any **Approved** or **Client accepted** ITP → **Propose to
master library** → give it a title → submit → then, as Admin, **Master ITP Library → Review
proposals →** → **Approve**. Then **+ New ITP → Start from a master template**, pick it, fill
in project/number/title → **Create ITP from template** — again, its checklist generates
immediately.

---

## Cleanup

Everything created in this walkthrough is real, isolated test data under the `Riverside
Fabrication Works` organisation — it doesn't touch the Meridian/Atlas/Northgate seed data. If
you want to remove it afterward, delete the `Workshop Crane Refurbishment` project (cascades
to its ITPs/checklists/NCRs) and then the organisation itself, both from the Supabase SQL
Editor (there's no in-app delete for either yet — matches the "no down-migration" discipline
in `supabase/MIGRATIONS.md`, deletion is a deliberate, explicit action, not a UI button).
