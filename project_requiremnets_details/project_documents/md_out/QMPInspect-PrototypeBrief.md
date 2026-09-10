JAGS ASSURANCE
Quality Management Platform
QMP INSPECT — PROTOTYPE BRIEF
Every screen and output, end to end — ready-to-paste Claude Design prompts
30 prototypes across 7 groups · use with the Requirements document
Version 1.2  ·  06 Sep 2026  ·  For the QMP developer  ·  Confidential
# Document Control — Revision History
[TABLE]
Rev | Date | Description of change
1.0 | 06 Sep 2026 | Initial prototype brief — 25 Claude Design prompts across 6 groups, with standard sample data.
1.1 | 06 Sep 2026 | Updated Spec-to-ITP and ITP builder prompts: checklists generated & numbered at ITP approval, numbers shown in Records/Evidence, and live ITP completion rollup.
1.2 | 06 Sep 2026 | Added Group 7 prototypes: Calibration / Welder / Material registers, register-fed ITP auto-verification (flagship), and engagement mode / conditional handover.
[/TABLE]
# How To Use This Brief
This document holds ready-to-paste prompts to build a visual prototype of every QMP Inspect screen and output in Claude Design. The prototypes are the VISUAL TARGET — they show what the product should look like and do. The developer builds the real, data-connected version from the Requirements document; these pictures make the intent unmistakable.
[TABLE]
✓  How to run it | Open Claude Design, upload the Jags logo first, then paste one prompt at a time. | Claude Design will ask for content details — use the Standard Sample Data on the next page so every screen looks consistent. | Build one screen at a time (say 'next' between screens) for best quality. | Do it group by group over a few sessions — it's a large set (25 screens).
[/TABLE]
[TABLE]
ℹ  Priority order if time is short | Group 2 (Spec-to-ITP), Group 3 (ITPs) and Group 6 (outputs) first — they are the | heart of the product and the client-facing deliverables. Then fill in the rest.
[/TABLE]
[TABLE]
💡  Pair with the Requirements doc | Prototype = what it looks like. Requirements = what it does and the rules. | Together they are the complete picture for the developer.
[/TABLE]
# Standard Sample Data (use everywhere)
When Claude Design asks for content, use these same values across every screen so the whole prototype feels like one coherent product.
[TABLE]
Field | Value
Client | Meridian Energy Holdings
Project | Coastal LNG Terminal Expansion — Package 4
Contractor | GFL Engineering & Construction
Discipline | Electrical
Specification | Electrical Specification Rev B (GFL-ELEC-SPEC-004)
Standards | IEC 60204-1, IEC 60364-5-52, IEC 60364-6, ISO 9001
ITP number | GFL-JAGS-ITP-001-Rev0
Checklist number | GFL-JAGS-CHK-001-2.1
Equipment (FAT) | Crusher — model X, serial Y (vendor works)
Notice period | Hold: 48h · Witness: 24h
People | A. Menon (QA Lead), R. Kumar (Senior QA Manager)
Parties | C Contractor · SC Subcontractor · TPI Lab · JA Jags · CL Client
Client KPIs | First-time pass 94%, Hold-point turnaround 18h, NCR close-out 6d, Data-book readiness 88%, Inspections 42/50, ITP completion 76%
Power BI tiles | 12 clients, 27 projects, 92% avg pass rate, 6 open NCRs
Brand | Burgundy #6B1E2C, Gold #F5C518, off-white #F9F7F4, Inter font, Jags logo top-left
[/TABLE]
# Group 1 — Platform & Navigation
The way in and around the platform.
### Prototype 1.1 — Login & Platform Home
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 1.1: LOGIN & PLATFORM HOME
Design two screens for the Jags Assurance Quality Management Platform. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | (a) A branded login screen (email + password, forgot-password link, request-access link). | (b) A platform home 'orbit hub': the logo in a centre circle with the 10 QMP modules around it (Inspect, Resource, Audit, Comply, Improve, ISO, PreQual, Train, Surveillance, future) — Inspect highlighted/active, others greyed. A 'Welcome back, Naresh' line and headline stats across the top: Active Projects 12, Active ITPs 34, Pending Inspections 8, Overdue Hold Points 2.
[/TABLE]
### Prototype 1.2 — Inspector Dashboard
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 1.2: INSPECTOR DASHBOARD
Design the QMP Inspect inspector dashboard. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | Burgundy left sidebar: Dashboard, Projects, ITPs, Inspections, NCRs & Observations, Registers, Vault, Reports, Settings. | Four headline cards: Active projects, Active ITPs, Pending inspections, Overdue hold points. | A 'My pending actions' list and an 'Awaiting my sign-off' list, as compact rows. Clean and scannable.
[/TABLE]
### Prototype 1.3 — Mode & Service-Model Selection
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 1.3: MODE & SERVICE-MODEL SELECTION
Design a 'Start work' screen for QMP Inspect. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | Show the two modes as two clear cards: 'ITP-driven project' and 'Standalone assignment (FAT / specific inspection)', each with a short description. A subtle note that access (Jags-managed / client self-managed / hybrid) is set by role.
[/TABLE]
# Group 2 — The Vault & Spec-to-ITP (the standout)
Where documents live, and the AI that turns a spec into an ITP.
### Prototype 2.1 — Central Vault
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 2.1: CENTRAL VAULT
Design the QMP Inspect document vault for a client. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | Left list of 11 folders: Drawings, Specifications, Standards & Codes, Material Submittals, RFIs, Method Statements, ITPs, Checklists & Forms, Approvals & Correspondence, Certificates, General Reference. | Specifications folder open, showing spec documents with name/revision/date (e.g. Electrical Specification Rev B). A gold 'Generate ITP from this specification' button on a selected spec.
[/TABLE]
### Prototype 2.2 — Spec-to-ITP AI Workflow (4 steps)
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 2.2: SPEC-TO-ITP AI WORKFLOW (4 STEPS)
Design the AI 'Spec-to-ITP' workflow for QMP Inspect as 4 connected screens; build one at a time. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. Gold AI accents. | Step 1: pick a spec from the vault + tick applicable standards (IEC, ACI, ASME, ISO). | Step 2: a tasteful 'AI reading the specification…' working state. | Step 3: the AI-drafted ITP in an editable table; each activity shows suggested per-party intervention points marked 'AI suggested' with confirm controls; add/edit/delete on rows; banner 'AI-drafted — review required'. | Step 4: an 'Approve ITP' step with a named approver, then — ON APPROVAL — the linked checklists are auto-generated and numbered (e.g. GFL-JAGS-CHK-001-2.1) and their numbers appear in the Records/Evidence column; plus a 'Download ITP' button. Note: after drafting, the ITP can be downloaded to edit offline and re-uploaded as a draft for approval.
[/TABLE]
# Group 3 — ITPs (build screen + final documents)
The ITP as built in-app, and as the finished controlled document.
### Prototype 3.1 — ITP Builder (in-app)
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 3.1: ITP BUILDER (IN-APP)
Design the in-app ITP Builder for QMP Inspect. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | A table of activities grouped into sections (Submittals, Execution, Testing, Handover). Each row: item no., activity, reference, acceptance criteria, method/frequency, a single 'Intervention Points' column showing per-party code chips (e.g. C:H  TPI:W  JA:R  CL:W), records/evidence (with linked checklist numbers), and an edit control. Add-activity button. A discipline tag (Electrical) on the ITP. Show a live 'ITP completion %' that rolls up from the activities' linked checklists and required documents.
[/TABLE]
### Prototype 3.2 — Final ITP Document (A4, full)
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 3.2: FINAL ITP DOCUMENT (A4, FULL)
Design the complete finished ITP as a professional A4 PDF (portrait). Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | (1) Header: logo, title 'INSPECTION & TEST PLAN', doc-control block (Doc No. GFL-JAGS-ITP-001-Rev0, Revision, Date, Page x of y). | (2) Project/traceability block: Project, Client, Contractor, Location/Area, Discipline, Specification reference, Applicable standards, Notice period (Hold 48h, Witness 24h), Prepared by, Reviewed by, Approved by, Client acceptance. | (3) Activity table grouped in 4 sections; columns: Item, Activity, Reference, Acceptance Criteria, Method/Frequency, a single compact 'Intervention Points' column with colour chips (C:H TPI:W JA:R CL:W), Records/Evidence, Sign-off. Realistic electrical rows. Table flows continuously — no big gaps between sections. | (4) Two legend boxes: party codes (C/SC/TPI/JA/CL) and point types (H/W/R/S) with the notice-period note. | (5) Approvals block (Prepared/Reviewed/Approved/Client acceptance — name, signature, date). | (6) Footer: Doc No., Revision, Page x of y, 'Uncontrolled when printed', jagsassurance.com.
[/TABLE]
### Prototype 3.3 — ITP Revision History & Distribution page
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 3.3: ITP REVISION HISTORY & DISTRIBUTION PAGE
Design page 3 of the ITP document (branded A4). Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | A Revision History table (Rev, Date, Description of change, By), a Distribution List (organisation, recipients), and a full Approvals signature block.
[/TABLE]
# Group 4 — Checklists, Inspections & the Field
Building checklists, and the on-site experience.
### Prototype 4.1 — Checklist Builder (in-app)
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 4.1: CHECKLIST BUILDER (IN-APP)
Design the in-app Checklist/Form builder for QMP Inspect. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | Name, discipline, standard fields; a list of items each with description and mandatory toggle; reorder handles; 'Create checklist or form' and duplicate buttons; a preview showing Yes/No/N-A + comments.
[/TABLE]
### Prototype 4.2 — Field Checklist (tablet)
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 4.2: FIELD CHECKLIST (TABLET)
Design the field checklist as a tablet screen. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | Show the checklist number (GFL-JAGS-CHK-001-2.1) and a traceability header (project, client, ITP ref, location, drawing rev, spec, date). | Items with large Yes (green) / No (red) / N-A (grey) buttons and a comments field each; show a measured value in one comment. Overall PASS banner and a signature area. Large touch targets, readable outdoors.
[/TABLE]
### Prototype 4.3 — Inspection Record & IRN
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 4.3: INSPECTION RECORD & IRN
Design two things for QMP Inspect. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | (a) An inspection record screen: results, attached photos, inspector signature, status. | (b) The Inspection Release Note (IRN) as a small branded A4 certificate confirming the activity passed, with traceability header and signatures.
[/TABLE]
# Group 5 — NCRs, Registers & Data Book
Findings, the live registers, and the handover record.
### Prototype 5.1 — NCR Form & Close-Out
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 5.1: NCR FORM & CLOSE-OUT
Design two things. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | (a) The NCR form: traceability header; choice of Major NCR (red)/Minor NCR (amber)/Observation (blue); description marked 'AI-drafted'; requirement; assigned-to + due date; severity; photo; signature. | (b) An NCR Close-Out certificate: root cause, corrective/preventive action, verification, closed.
[/TABLE]
### Prototype 5.2 — NCR & Observation Registers
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 5.2: NCR & OBSERVATION REGISTERS
Design two live register screens for QMP Inspect. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | NCR Register and Observation Register. Each: a stats bar (total, open, overdue, closed), an aging mini-chart, a filterable table (ref, project, type chip, status, due date, days open), and an Export button.
[/TABLE]
### Prototype 5.3 — ITP Register
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 5.3: ITP REGISTER
Design the ITP Register for QMP Inspect. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | A table of all ITPs (ITP number, project, discipline, revision, status Draft/Issued/Superseded, % complete, open items), filters, and Export to PDF/Excel.
[/TABLE]
### Prototype 5.4 — Data Book Builder
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 5.4: DATA BOOK BUILDER
Design the Data Book Builder for QMP Inspect. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | A checklist of sections (ITPs, inspection records, test certificates, NCRs closed, as-builts) each showing complete/incomplete, an overall 'readiness %', and a 'Compile Data Book' button disabled until all verified.
[/TABLE]
# Group 6 — FAT / Standalone, Reports, KPIs & Power BI (the outputs)
The deliverables — what the client and Jags actually receive and see.
### Prototype 6.1 — Standalone / FAT Assignment
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 6.1: STANDALONE / FAT ASSIGNMENT
Design the FAT / standalone assignment screen for QMP Inspect. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | Assignment type (FAT / witness inspection / specific test / pre-shipment), client, equipment (Crusher — model X, serial Y), location (vendor works), date, standard reference. Attached FAT checklist. Space for measurements, photos, punch-list items, and witness signatures.
[/TABLE]
### Prototype 6.2 — FAT Report (A4) — client deliverable
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 6.2: FAT REPORT (A4) — CLIENT DELIVERABLE
Design the FAT Report as a professional branded A4 document — the client deliverable. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | Logo header + doc control; equipment details; standard/spec reference; checklist results table; measurements/test data; photos; a punch list; a clear conclusion (Pass / Conditional Pass with punch list / Fail); and witness signatures (Jags, vendor, client). Make it look first-class.
[/TABLE]
### Prototype 6.3 — Inspection Report (A4)
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 6.3: INSPECTION REPORT (A4)
Design a general Inspection Report as branded A4. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | Logo header, traceability block, inspection summary, results table, photos/evidence area, signature block, footer with page number and jagsassurance.com.
[/TABLE]
### Prototype 6.4 — Client KPI Dashboard
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 6.4: CLIENT KPI DASHBOARD
Design the client KPI dashboard (what the client sees — their project only). Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | Six KPI cards: first-time pass rate 94%, hold-point turnaround 18h, NCR close-out 6 days, data-book readiness 88%, inspections completed vs planned 42/50, ITP completion 76%. A bar chart of inspections over time, a 'quality by subcontractor' list, and the client's open items.
[/TABLE]
### Prototype 6.5 — Monthly Client Report Pack
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 6.5: MONTHLY CLIENT REPORT PACK
Design a branded monthly client report pack: a cover page and a contents/summary page (PDF look). Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | Include KPIs, progress per project, NCR summary, and vendor performance — the professional monthly deliverable the client receives.
[/TABLE]
### Prototype 6.6 — Jags Power BI Command Centre (internal)
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 6.6: JAGS POWER BI COMMAND CENTRE (INTERNAL)
Design a Power BI-style analytics dashboard for Jags INTERNAL use, showing ALL clients/projects. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | KPI tiles (12 clients, 27 projects, 92% avg pass rate, 6 open NCRs); charts for inspections completed vs planned, first-time pass rate, NCR trends, hold-point turnaround; and a vendor-performance league table. Looks like a real BI dashboard (mockup, not live data).
[/TABLE]
### Prototype 6.7 — Handover Portal
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 6.7: HANDOVER PORTAL
Design the multi-service handover portal (client view). Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | Each service handed over separately, showing data book download, acknowledgement status, and dates — all of the client's services in one portal.
[/TABLE]
# Group 7 — Vault Registers & Auto-Verification (added)
The registers the vault generates, and the flagship auto-verification that feeds ITP records. These are recent additions to the spec.
### Prototype 7.1 — Calibration Register
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 7.1: CALIBRATION REGISTER
Design the Calibration Register for QMP Inspect, generated from the Calibration Certificates folder in the vault. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | A table: instrument/equipment, cert number, calibration date, DUE DATE, status. Flag instruments due within 30/90 days in amber and overdue/expired in red. A stats bar (total, in-cal, due soon, expired) and an Export button. Show a 'Generate register from folder' action.
[/TABLE]
### Prototype 7.2 — Welder Qualification Register
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 7.2: WELDER QUALIFICATION REGISTER
Design the Welder Qualification Register, generated from the Welder Qualifications folder. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | A table: welder ID/name, qualified WPS/PQR, qualified ranges (process, position, thickness, material group), qualification/continuity expiry, status. Flag expiring/expired qualifications. Stats bar + Export.
[/TABLE]
### Prototype 7.3 — Material Register
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 7.3: MATERIAL REGISTER
Design the Material Register, generated from the Material Submittals folder. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | A table: material, submittal reference, approval status (A / B / C / D coding shown as colour chips), approved date, status. Shows what is approved for use. Filters + Export.
[/TABLE]
### Prototype 7.4 — Register-Fed ITP Auto-Verification (flagship)
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 7.4: REGISTER-FED ITP AUTO-VERIFICATION (FLAGSHIP)
Design how register-fed auto-verification looks on an ITP activity in QMP Inspect. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | Show an inspection activity that involves a material, an instrument, and a welder. Beside each, the system has AUTO-CHECKED the relevant register and auto-filled a verification line — e.g. 'Material approved — submittal ref X (Material Register)', 'Gauge G-102 in-cal, cert Y, due Z (Calibration Register)', 'Welder W-14 qualified WPS-3 (Welder Register)' — each with a green tick and a 'Confirm' control for the inspector. | Then show a NON-CONFORMANCE case: an unapproved material triggers a clear amber/red WARNING ('Material not approved') with a 'Proceed with reason' field (soft-stop) — the inspector can proceed after entering a reason, which is recorded. Make it obvious this is automatic conformance checking with the inspector confirming.
[/TABLE]
### Prototype 7.5 — Engagement Mode & Conditional Handover
[TABLE]
PASTE INTO CLAUDE DESIGN — PROTOTYPE 7.5: ENGAGEMENT MODE & CONDITIONAL HANDOVER
Design two small admin/settings views for QMP Inspect. Brand: burgundy #6B1E2C, gold #F5C518 accents, off-white #F9F7F4 background, Inter font, Jags logo top-left. Premium enterprise look. | (a) Engagement mode setting for a client: three options — Jags-led (Jags logo + Jags numbering), Co-branded (client logo + 'Powered by Jags'), White-label (client logo + client's own numbering) — showing that this one choice drives both branding and numbering. | (b) A 'Conditional Handover' confirmation: when punch items are still open, a senior user can issue handover with the open punch list shown on the certificate, requiring an approver name and reason. Default is blocked until punch closed; this is the documented exception.
[/TABLE]
# That's the Full Set
[TABLE]
✓  You've covered every screen and output | Group 1: platform & navigation (3).  Group 2: vault & spec-to-ITP (2). | Group 3: ITPs, build + final documents (3).  Group 4: checklists & field (3). | Group 5: NCRs, registers & data book (4).  Group 6: FAT, reports, KPIs & Power BI (7).  Group 7: vault registers & auto-verification (5). | Together: the complete visual picture of QMP Inspect, end to end.
[/TABLE]
[TABLE]
💡  Final reminders | These are the visual target, not the code — the developer builds the real version from the Requirements doc. | Keep the sample data consistent so it all feels like one product. | Add real screenshots to the guides once the module is built.
[/TABLE]
JAGS ASSURANCE  ·  jagsassurance.com