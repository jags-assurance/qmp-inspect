# Complete project lifecycle guide — every feature, one project, as JAGS Admin

This is the full picture: playing JAGS Admin, running one real project through literally
everything the platform can do, in the order you'd actually use it. It builds directly on
`docs/FRESH_ORG_WALKTHROUGH.md` — do that guide's 12 steps first (create `Riverside
Fabrication Works`, project `RFW-2026-001`, four parties, one approved ITP with a passed
inspection, one closed NCR, a compiled data book, an issued handover, KPIs showing 100%
first-time pass). Everything below picks up from there and covers every feature that guide
doesn't: reports, AI drafting, dashboards, RBAC, the activity log, priority routing, standalone
assignments, and the two engagement-tier variants.

Log in as `admin@jagsassurance.local` / `DemoPass123!` unless a step says otherwise.

Each phase below is a self-contained process — read the intro line to see what it actually
proves, then follow the numbered steps.

---

## Phase 13 — Organisation-level configuration

These are normally set up front, before Phase 1 of the base walkthrough, but are covered here so
the base walkthrough itself stays uncluttered. Each is independent — do them in any order.

### 13.1 Engagement mode & scope

Sidebar → **Client Organisations** → open `Riverside Fabrication Works`:

- **Engagement mode** (`jags_led` / `co_branded` / `white_label`) — controls whose branding
  appears on generated documents and numbering. Set to `co_branded` to see both JAGS's and
  Riverside's identity on the next PDF you generate in Phase 17.
- **Engagement scope** (`full_service` / `self_managed`) — controls *who does the work*, not
  branding. Leave this at the default `full_service` for now; Phase 22 below covers flipping it.

### 13.2 Custom intervention levels (beyond Hold/Witness/Review/Surveillance)

Sidebar → **Intervention Levels** (Admin only). The default four (H/W/R/S) are seeded per
organisation on creation, at `sort_order` 1/2/3/4 respectively (Hold is lowest, i.e. first).
Adding a level is a two-step process — the add form doesn't take a sort order (a new level is
always appended after the existing ones, so a brand-new level alone never gates Hold):

1. **+ Add level**: code `CIR`, label `Client Internal Review`, check **Is blocking**, default
   notice hours `12`. It's created at the next available sort order (5) — after Hold, so it
   wouldn't gate anything yet.
2. Edit that same row (the existing rows' inline form) and change its **Sort order** to `0` —
   lower than Hold's `1`.

Because this is now a **second blocking level with a lower sort order than Hold**, it forms a
real hierarchy: on any activity where both `CIR` and `H` are assigned, the H cell cannot be
signed off until the CIR cell is signed off (or proceeded-without-response) first — trying it out
of order returns "Client Internal Review must be signed off (or proceeded without response)
before this level can be." Verify this on item 1.1 of the ITP from the base walkthrough: assign
`CIR` to the client party alongside the existing `H`/`W`, and try signing the Hold cell first —
it should be rejected until CIR clears.

### 13.3 Notice period overrides

Sidebar → **Intervention Levels** → edit the `W` (Witness) row's **Default notice hours** field
down to `1` for this org instead of the seeded default `24` (there's also a project-level
`notice_period_configs` override that takes precedence over this org default if one exists for a
given project+level, but there's no UI to create one yet — editing the org-level default here is
the real, reachable way to do this today). This is the fastest way to actually test **Proceed
without response** end-to-end without waiting a full day.

### 13.4 Brand colors, numbering format, plans & seats

Sidebar → **Brand Colors**: set Riverside's own accent color for their co-branded documents.
Sidebar → **Numbering**: check/change the document number format (`{clientCode}-{originatorCode}-{DOCTYPE}-{seq}` by default).
Sidebar → **Plans & Seats**: confirm Riverside's seat limit and current usage.

### 13.5 Custom RBAC roles

Sidebar → **Custom Roles** (Admin only) — this is the action-level permission system, separate
from the fixed `party_type` roles (client/subcontractor/main_contractor/tpi_lab). Create a
permission grant: `reassign_project_party` scoped to `RFW-2026-001`, granted to Dana Cole
(Riverside's client user). This lets her reassign which login can sign off on a party without
needing JAGS Admin or a team lead to do it for her — verified in Phase 21.

### 13.6 Teams & delegation

Sidebar → **Teams** (visible to any staff who leads a team, not just Admin) — create a team,
assign it to `RFW-2026-001`, and make one Inspector its lead. A team lead can do everything an
Admin can on their own team's projects (e.g. reassign a signoff party) without a global Admin
grant.

### 13.7 Mandatory MFA

Sidebar → **Security** — every JAGS staff login (Admin or Inspector) is required to enrol MFA.
If you haven't already, enrol it here now; the app blocks staff actions until this is done.

---

## Phase 14 — Personnel certifications register

Before field work starts on item 3.1 (the load test), record who's certified to perform it.
Project detail page → **Registers** → **Personnel Certifications** → add:

| Field | Value |
|---|---|
| Project party | Ironhold Welding Services |
| Certification type | `Crane Rigging & Lifting` |
| Cert number | `CRL-2026-0042` |
| Expiry date | 12 months from today |

When you (or an inspector) later record a response on an activity this party is linked to,
the checklist row shows the register's live status (`valid` / `expiring_soon` / `expired`) as a
soft-stop warning — try setting the expiry date to yesterday instead and re-check item 3.1's
checklist row: it should require a typed override reason before Yes/No/N-A becomes clickable.

---

## Phase 15 — Priority routing: how "what's next" actually gets decided

Log in as an Inspector (`inspector@jagsassurance.local` / `DemoPass123!`) instead of Admin for
this phase. Their dashboard's **"My pending actions"** panel is not a fixed queue — it's derived
live:

1. Every checklist template with no completed inspection record yet is a candidate.
2. Its priority is derived from the real intervention levels already assigned to that activity:
   any **blocking** level present → **High**; a non-blocking level with a configured notice
   period → **Medium**; anything else → **Low**.
3. Within the same priority tier, the longest-waiting item surfaces first.

Prove it: create a second ITP item with no intervention points at all (Low priority, brand new)
and compare its position in the worklist against item 1.1 from the base walkthrough (which has a
Hold assigned — High priority). The Hold-gated item should rank above the brand-new one even
though it's older, and above any Low-priority item regardless of age.

---

## Phase 16 — Standalone / FAT assignment (the non-ITP path)

Not every inspection needs a full ITP — a one-off vendor witness test doesn't need a project-wide
document. Sidebar → **Start work** → **Standalone assignment**:

| Field | Value |
|---|---|
| Project | `RFW-2026-001` |
| Assignment type | `FAT` (Factory Acceptance Test) |
| Equipment description | `Crane hoist motor — pre-delivery FAT` |
| Manufacturer / Model | `Torqmaster / TM-500H` |

Build its own ad-hoc checklist, record responses, add a punch item if something's conditional,
then **Finalize** with conclusion `conditional_pass`. This sets `status = completed` and (as of
this session) a real `completed_at` timestamp — check Phase 19's activity log afterward and
confirm "RFW-2026-001-FAT-1 — Crane hoist motor — pre-delivery FAT completed (conditional pass)"
appears with today's date/time, not a guessed one.

---

## Phase 17 — Generating and downloading every report type

All four PDF types share the same pattern: click **Generate**, watch it poll live (no manual
reload), then both **View** and **Download** links appear automatically once ready.

1. **ITP PDF** — on the ITP page, click **Generate PDF**.
2. **Inspection Report PDF** — on the completed inspection record from Phase 9 of the base
   walkthrough, click **Generate report**.
3. **FAT Report PDF** — on the standalone assignment from Phase 16, click **Generate report**.
4. **Portfolio Summary PDF** — Sidebar → **Portfolio Insights** (Admin only) → **Export portfolio
   summary (PDF)** — a single PDF summarising every active project across every organisation, for
   sending to a stakeholder without compiling per-project reports by hand.

For each: confirm **View PDF →** opens it inline, and **Download PDF ↓** actually forces a save
(check your browser's download bar/`Content-Disposition` — this is a real forced download via a
signed URL, not just a link that happens to point at a PDF).

---

## Phase 18 — AI-drafted report narrative

On the Inspection Report from Phase 17, find the **Report conclusion / narrative** panel → click
**Draft with AI**. It drafts a conclusion paragraph from the record's own real facts (result,
activity, standard, evidence) — review it, edit the text freely, then **Save narrative**. This
saved text becomes the PDF's conclusion paragraph the next time you regenerate it; leaving it
blank falls back to an automatic factual summary instead.

Repeat on the FAT Report from Phase 16 — same component, same behaviour, different record.

---

## Phase 19 — The full Activity log

Project detail page → **Activity**. By this point in the walkthrough you should see, in reverse
chronological order, real events across every category:

- ITP created / moved to review / approved / accepted by the client
- Sign-off notified / signed off / (if you tried 13.3's proceed-without-response) proceeded
- Inspection completed (pass/fail/partial)
- NCR raised / closed
- Standalone assignment completed
- Data book compiled
- Handover certificate issued / acknowledged
- Punch list item opened / closed
- Document Vault upload (if you tried the AI-from-vault-documents path in the base walkthrough's
  optional section)

Every line here is backed by a real, already-recorded timestamp — nothing on this page is
inferred or invented. If a category above is missing from your feed, it's because that specific
action genuinely hasn't happened yet on this project, not because the feed is hiding it.

---

## Phase 20 — Dashboards, one per role

Log out and back in as each of these to see the same project from a different seat:

- **JAGS Admin** (`admin@jagsassurance.local`) — org-wide portfolio view, pending master-library
  proposals, usage/cost.
- **JAGS Inspector** (`inspector@jagsassurance.local`) — the priority-routed worklist from Phase 15.
- **Client / Subcontractor / Main Contractor / TPI-Lab** (any external party you've linked a
  login to) — stat cards, their own sign-off queue only, and the **"Your projects — reports &
  documents"** panel with direct links to that project's Reports, Data Book, Activity and KPIs —
  no need to drill through the Projects list first.

---

## Phase 21 — Custom RBAC in practice

Log in as Dana Cole (Riverside's client user, if you set up a real login for her — otherwise
follow this conceptually). Because of the `reassign_project_party` grant from 13.5, she can now
open `RFW-2026-001`'s own project detail page (**Project parties** section, next to each party) and
reassign which login is linked to, say, the Subcontractor party — an action normally restricted to
a JAGS Admin or a team lead. Confirm the reassignment actually changes who can sign off that
party's cells (the old linked user can no longer sign; the new one can) — this is the real
mechanism `custom RBAC` grants, checked in the same place the fixed Admin/team-lead check already
lived, not a separate parallel system.

---

## Phase 22 — Self-Managed / Platform-Only variant

This changes *who* does the work, not any of the mechanics above. On a **new** organisation
(don't flip Riverside mid-walkthrough — it would orphan the JAGS-run project you just built):

1. Client Organisations → create `Northfield Utilities`, engagement scope `self_managed`.
2. Create a project under it, and a `client` party linked to a real login for that org.
3. Log in as that client login → **+ New ITP** is now available to them directly (no JAGS
   Inspector step in between) — this unlocks org-wide the moment `engagement_scope` is
   `self_managed`, without needing the project-level `allow_client_itp_creation` flag JAGS would
   otherwise have to set per project.
4. That client builds, approves-internally, executes, and closes out the entire ITP lifecycle
   themselves. JAGS Admin's role for this org shrinks to **Portfolio Insights** / **Usage & Cost**
   visibility only — no operational involvement.

---

## Phase 23 — Offline mode

On a mobile/tablet session (or simulate it: DevTools → Network → Offline), open a checklist and
record a Yes/No/N-A response. It queues in the local outbox (IndexedDB) instead of failing, shows
a "pending sync" banner, and flushes automatically the moment connectivity returns — confirm the
response actually lands in the checklist once you go back online.

---

## Wrap-up checklist

By the end of this guide plus the base walkthrough, you will have exercised, on real data:

- [ ] Organisation setup: engagement mode, engagement scope, custom intervention levels, notice
      period overrides, branding, numbering, plans/seats, custom RBAC, teams, MFA
- [ ] Project + all four party types + personnel certifications
- [ ] All three ITP-creation paths (manual / master template / AI-from-vault-documents)
- [ ] Hierarchical (multi-level) sign-off chain, notify, sign off, proceed-without-response
- [ ] Field checklist execution, offline queue
- [ ] NCR raise → root cause (AI-assisted) → close, with automatic punch-list linkage
- [ ] Standalone/FAT assignment, independent of the ITP flow
- [ ] All four PDF report types, each with real View + Download
- [ ] AI-drafted report narrative
- [ ] Data book compile → handover issue → client acknowledgment
- [ ] Full activity log across every event category
- [ ] Every dashboard perspective (Admin, Inspector, four external-party roles)
- [ ] Custom RBAC granting a specific action beyond the fixed role set
- [ ] The Self-Managed/Platform-Only variant, on a second organisation

If any step above behaves differently from what's described — that's a real bug to report, not
expected variation; every mechanic in this guide is backed by code read and verified in this
project's own source, not assumed from a spec.
