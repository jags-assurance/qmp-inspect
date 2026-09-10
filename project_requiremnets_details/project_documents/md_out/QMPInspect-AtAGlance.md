JAGS ASSURANCE
Quality Management Platform
QMP INSPECT AT A GLANCE
Deliverables · The Central Vault · Where the outputs go
A quick reference for the team, the developer, and client conversations
Version 1.2  ·  06 Sep 2026  ·  Confidential
# Document Control — Revision History
Version-controlled; current version on the cover. Changes recorded below.
[TABLE]
Rev | Date | Description of change
1.0 | (initial) | Initial QMP Inspect at-a-glance — deliverables, vault, outputs.
1.1 | 06 Sep 2026 | Added two modes (ITP-driven + FAT/standalone), FAT report deliverable, and service models.
1.2 | 06 Sep 2026 | Added vault-generated live registers (calibration, welder, material, punch-list) and register-fed ITP auto-verification.
[/TABLE]
# 1. Key Deliverables — What QMP Inspect Produces
These are the actual outputs of the module — what clients receive and what auditors review. QMP Inspect works in two modes: the full ITP-driven lifecycle, and standalone assignments (a FAT or specific inspection/test where the report is the deliverable).
[TABLE]
Deliverable | What it is
ITP | The Inspection & Test Plan — the master planning document. Three-phase, per-party intervention grid (H/W/R/S per party), revision-controlled.
Checklists & Forms | Generated from the spec, numbered and linked to their ITP activity (e.g. GFL-JAGS-CHK-001-2.1). Completed on site with Yes/No/N-A + comments.
Inspection Records | The completed inspections — results, photos, digital signatures, traceability header.
IRN | Inspection Release Note — issued when an activity passes.
FAT / Inspection Report | Standalone mode: the deliverable for a FAT or specific inspection/test — branded report or test certificate with results, measurements, photos, punch list and conclusion.
NCRs & Observations | Non-conformances and observations, graded, with full CAPA close-out and close-out certificates.
Data Book | The auto-compiled complete quality record for handover; blocks until all items verified.
Reports | Inspection reports, progress reports, and the monthly client report pack (PDF + Excel).
Registers | Live, exportable ITP Register, NCR Register, and Observation Register.
KPIs & Analytics | Client KPI dashboards and the Jags-internal Power BI command centre.
[/TABLE]
# 2. The Central Vault
The vault is the shared per-client document store — one per client, shared across all that client's services. It holds 11 folders:
[TABLE]
Drawings | Method Statements
Specifications | ITPs (approved)
Standards & Codes | Checklists & Forms
Material Submittals | Approvals & Correspondence
RFIs | Certificates
General Reference | 
[/TABLE]
[TABLE]
✓  What makes the vault special | It is the SOURCE for AI ITP generation — pick a spec and the AI drafts the ITP + checklists. | It generates LIVE registers from its folders — Calibration, Welder Qualification, Material, Punch-List — with expiry/status flags. | Those registers FEED ITP verification: materials, instruments and welders are auto-checked (approved? in-cal? qualified?), auto-filling the verification for the inspector to confirm, and warning (soft-stop, reason recorded) on non-conformance. | Everything is linked, traceable, and isolated between clients.
[/TABLE]
# 2b. Service Models — How Clients Use It
The same module can be delivered three ways, chosen per client (via roles and licensing) — useful to know for client conversations and pricing.
[TABLE]
Model | Who does the work | Revenue type
Jags-managed | Jags does everything; client sees KPIs, accepts ITPs, gets reports | Service (day rates)
Client self-managed | Client's team runs it; Jags provides the platform + support | Licence / subscription
Hybrid | Jags does some, client does some (as agreed) | Blend
[/TABLE]
It is the same module for all three — controlled by each user's role and the client's licensing. No separate build.
# 3. Where the Outputs Go
Each deliverable appears in up to three places, each for a different audience. This matters: the documents live in the app; Power BI is the analytics layer (the numbers), not a document store.
[TABLE]
Deliverable | In the app | Download | Power BI (Jags)
ITP | Yes | PDF/Word/Excel | Completion %, status
Checklists | Yes | Yes | Pass rates
Inspection / IRN | Yes | Yes | Inspections done
NCRs / Observations | Registers | Certificates | Trends, aging
Data Book | Builder | Yes | Readiness %
KPIs | Client dashboard | Report pack | Full command centre
[/TABLE]
[TABLE]
ℹ  Key point about Power BI | Power BI is Jags-INTERNAL only and is the ANALYTICS layer — it reads the data | behind the deliverables to show trends and performance across all clients and | projects (inspections completed vs planned, pass rates, NCR trends, turnaround, | vendor performance). The documents themselves live and download in the app. | Clients get their numbers on their own KPI dashboard and in the monthly report | pack — they do NOT get live Power BI access.
[/TABLE]
### The one-line flow
Spec in the vault → AI drafts the ITP + numbered checklists → team edits & approves → inspections on site (checklists, signatures, IRNs) → NCRs/observations as needed → data book compiled → handover to client → KPIs and Power BI throughout.
JAGS ASSURANCE  ·  jagsassurance.com