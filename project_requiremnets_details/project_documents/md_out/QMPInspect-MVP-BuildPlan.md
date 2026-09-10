JAGS ASSURANCE
Quality Management Platform
QMP INSPECT — MVP BUILD PLAN
Build this first — the achievable first version
Then add the advanced features in phases
Version 1.0  ·  06 Sep 2026  ·  For the QMP developer  ·  Confidential
# Why an MVP First
The full QMP Inspect requirements describe about 30 features. Building all of them before launching risks the project stalling. This plan defines the MVP — the smallest version that is genuinely useful and can run a real job end to end (including the crusher FAT). Build the MVP first, prove it works, then add the advanced features in phases.
[TABLE]
✓  The principle | Ship small, learn from real use, expand. | A working 12-feature app beats a half-built 30-feature one. | Run your first real assignment (the crusher FAT) through the MVP to learn what matters. | Add the sophisticated features (AI, register-fed verification, per-party grids) once the core is solid.
[/TABLE]
[TABLE]
⚠  Two things that are NOT optional, even in the MVP | Per-client data isolation — a client must never see another client's data. Get this reviewed by an experienced developer before any real client data goes in. | Secure login and roles. These are the security foundation and cannot be deferred.
[/TABLE]
# Phase 1 — The MVP (build this first)
The smallest genuinely useful version. Roughly matches Prompts 1–10 plus the essentials. Build and test each before the next. Goal: run a real inspection and a FAT end to end, with one client login.
[TABLE]
# | Feature | Why it's here
1 | Setup, brand & login | Project skeleton, Burgundy/Gold, Inter font, secure login (JWT + bcrypt).
2 | Roles & per-client isolation | Jags and client roles; strict data isolation. SECURITY FOUNDATION — do not defer.
3 | Database tables | Core tables: clients, projects, ITPs, activities, checklists, inspections, NCRs.
4 | Sidebar, layout & dashboard | Navigation and a simple dashboard of pending work.
5 | Projects | Create and manage client projects.
6 | ITP builder (basic) | Build an ITP with activities, point types, acceptance criteria (manual — no AI yet).
7 | Checklists (Yes/No/N-A) | Build/attach checklists; complete them with Yes/No/N-A + comments.
8 | Inspection + signature + photos | Record an inspection on site with photo and digital signature; issue IRN.
9 | NCR & Observation (basic) | Raise and close a non-conformance or observation.
10 | PDF reports (branded) | Generate the core branded reports (inspection report, ITP).
11 | Standalone / FAT mode | Run a specific inspection/FAT and issue a FAT report — needed for your crusher job.
12 | Client login (view + accept) | One client can log in, see their project, accept ITPs, download reports.
[/TABLE]
# Phase 2 — Add once the MVP works
The features that make it multi-client and richer. Add after the MVP is proven.
[TABLE]
# | Feature | Why it's here
13 | Client & module licensing | Multi-tenant home; light up licensed modules per client.
14 | Document vault | Per-client folders for drawings, specs, submittals, etc.
15 | Data book builder & handover | Auto-compile the quality record; service-by-service handover.
16 | Registers | ITP, NCR, Observation registers with stats and export.
17 | Configurable document numbering | Per-client numbering formats and traceability.
18 | KPI dashboard | Client KPIs: pass rate, turnaround, close-out, readiness, inspections done.
19 | Punch list + gating | Project punch list; gate the data book/handover until closed.
20 | Excel template download/import | Offline ITP/checklist prep with preview.
[/TABLE]
# Phase 3 — The advanced differentiators
The sophisticated, harder features. They are your differentiators — but build them once the core is solid, because they are the hardest to get reliably right.
[TABLE]
# | Feature | Why it's here
21 | AI: Spec-to-ITP generation | Pick a spec, AI drafts the ITP + checklists (human approves).
22 | AI: NCR/narrative drafting + assists | AI drafting across the module (human approves).
23 | Per-party intervention grid | H/W/R/S per party per activity, with sign-off.
24 | Two-tier master library | Jags master ITPs → client copies; save-back with approval.
25 | Multi-discipline & multi-party chain | Discipline sign-off; subcontractor→contractor→TPI→Jags→client.
26 | Vault-generated registers + auto-verification | Calibration/welder/material registers feeding ITP verification.
27 | Configurable notice periods & notifications | 24/48/72h notice; originator-raised, auto party-to-party.
28 | Engagement mode (branding + numbering) | Jags-led / co-brand / white-label per client.
29 | Power BI + monthly report packs | Jags internal analytics; client monthly PDF/Excel packs.
30 | PWA / offline field mode | Installable app, offline inspections that sync.
[/TABLE]
# How To Use This Plan
- Build Phase 1 in order. Test each feature before the next. Get security/isolation reviewed before real client data.
- Run the crusher FAT through the Phase 1 MVP — learn what matters in real use.
- Then add Phase 2, then Phase 3, in that order.
- Use the Requirements doc for the full detail of each feature, and the Prototype Brief to see how each screen should look.
[TABLE]
✓  The honest goal | A working, useful, secure MVP that runs a real job — sooner rather than later. | Not a perfect 30-feature app that takes a year before anyone uses it. | Every advanced feature is easier to build once the core is proven.
[/TABLE]
JAGS ASSURANCE  ·  jagsassurance.com