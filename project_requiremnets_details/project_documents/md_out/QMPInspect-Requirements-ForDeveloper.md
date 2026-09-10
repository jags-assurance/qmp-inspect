JAGS ASSURANCE
Quality Management Platform
QMP INSPECT
Requirements & Specification
What the module must do, for whom, and how it should look — the 'what', not the 'how'
For the developer — build it your way with Claude
Version 1.9  ·  06 Sep 2026  ·  Read the Platform Architecture overview first  ·  Confidential
# Document Control — Revision History
This document is version-controlled. The current version is shown on the cover; each change is recorded below. Always work from the latest revision.
[TABLE]
Rev | Date | Description of change
1.0 | (initial) | Initial QMP Inspect requirements — projects, ITPs, checklists, inspections, NCRs, data book, handover, KPIs, numbering, branding.
1.1 | (development) | Added per-party intervention grid, Spec-to-ITP AI generation, document-linked numbered pack, third-party 'expected → received' records, revisions & audit log, ITP register, three-format downloads (PDF controlled).
1.2 | (development) | Added engagement mode (branding + numbering together), configurable approvals (internal + external), vault-feeding options, expanded AI assists, client dashboard contents.
1.3 | 06 Sep 2026 | Added FAT / standalone assignment mode, service models (Jags-managed / self-managed / hybrid), originator-raised notifications, configurable notice periods (24/48/72h), and AI-ITP offline download-edit-upload round-trip.
1.4 | 06 Sep 2026 | Refined document-linked pack: checklists generated, numbered and linked at ITP approval (avoids orphans); checklist numbers auto-written into Records/Evidence; ITP completion rolls up from linked checklists and required documents.
1.5 | 06 Sep 2026 | Added Mobile & Offline Access: responsive web + installable PWA + offline field capability (one URL, no app store); native app-store apps noted as a Phase-2 option.
1.6 | 06 Sep 2026 | Added vault-generated live registers (Calibration, Welder Qualification, Material, Project Punch-List) and register-fed ITP verification (auto-fill + inspector confirm; soft-stop warning with recorded reason on non-conformance).
1.7 | 06 Sep 2026 | Punch-list gating: data book and handover block until the punch list is closed, with a documented, approved 'conditional handover with open punch list' exception; punch items flow from inspections, FATs, NCRs and final walk-down into one project register.
1.8 | 06 Sep 2026 | Made ITP sections explicitly editable — add / delete / rename / reorder sections (not a fixed set); AI-generated sections can be adjusted.
1.9 | 06 Sep 2026 | Specified that the ITP-generation AI prompt is built into the app (user clicks a button, never types a prompt) and must constrain output — standard sections, ~4-6 activities per section, inspection-worthy items only — so ITPs are concise, not sprawling.
[/TABLE]
# How To Read This Document
This is a requirements specification for QMP Inspect — the field-inspection module and the flagship of the platform. It describes WHAT the module must do, who uses it, the workflows, the data it holds, the look and feel, and the rules it must follow. It deliberately does NOT tell you how to build it — the technical design, structure and code are yours to decide with Claude.
[TABLE]
ℹ  Before this, read the Platform Architecture overview | That document explains the 10 modules, how they connect, and the platform-wide | standards (isolation, roles, brand, reporting). This document is the detail for | the first module. There are also clickable prototypes — ask Naresh — that show | the intended screens; use them for the look and layout.
[/TABLE]
[TABLE]
✓  Requirements are written as 'R1, R2…' so you can tick them off | Each numbered requirement is something the module must do or be. | Where a specific decision matters (a rule we've deliberately made), it's stated. | Where it doesn't, the choice is yours.
[/TABLE]
# 1. Purpose & Scope
QMP Inspect digitises Jags Assurance's field inspection service. It works in two modes: (1) the full ITP-driven lifecycle for a project — planning what will be inspected (the ITP), carrying out inspections, recording results and non-conformances, compiling the data book, and handing over; and (2) standalone assignments — a specific inspection or test (e.g. a FAT on a crusher) with the report as the deliverable, no full ITP required. Quality KPIs run throughout both.
### In scope
- Inspection & Test Plans (ITPs), checklists, on-site inspections, sign-offs.
- Standalone assignments: FAT, specific/witness inspections, and tests, with report/certificate as the deliverable.
- Non-conformance (NCR) and observation management with corrective action.
- Multi-discipline and multi-party inspection workflows.
- Data book compilation, handover, client KPIs, and reports.
- Multi-client (multi-tenant) operation with per-client isolation and licensing.
### Out of scope (handled by other modules or explicitly excluded)
- Audits (QMP Audit), the resource bench (QMP Resource), surveillance (separate module).
- Jags never provides professional engineering or engineering design — the module must never represent that it does.
# 2. Users & Roles
Several parties use the module, each seeing only what their role allows. Access control is essential — clients and external parties log in.
[TABLE]
Role | What they do / see
Jags admin/staff | Own the platform and master library; set up projects, clients, numbering, parties, disciplines; witness hold points; raise NCRs; compile the data book; run internal Power BI.
Client / Owner | Review and accept ITPs; see their KPIs and vendor performance; receive handover and monthly reports. Sees only their own data.
Subcontractor | The originator: request inspections, self-inspect, complete their checklist section, respond to NCRs.
Main Contractor | Review and confirm subcontractor work; coordinate disciplines.
TPI / Test Lab | Perform third-party testing; upload test reports at their step.
Discipline QA/QC (CSA, MEP…) | Each discipline prepares and verifies its own section before a hold point releases.
[/TABLE]
R1.  Provide secure login with role-based access; each role sees only what it should.
R2.  Enforce strict per-client data isolation — no client or external party can see another client's data.
# 3. Functional Requirements
Grouped by area. Each is a capability the module must provide. The specific decisions we've made are noted where they matter.
### 3.0 Service Models — Who Operates the Module
The SAME module supports three service models, chosen per client via roles and licensing (not separate builds). This is a business/access choice, delivered entirely through role-based access.
R3.  Jags-managed (Jags does everything): Jags builds ITPs, conducts inspections, raises NCRs and compiles the data book. Client users get view/accept-light roles (see KPIs, accept ITPs, receive reports and handover). This is the service-delivery model — the platform is how Jags delivers its expertise.
R4.  Client self-managed (platform as a tool): the client's own QA team uses the module to run their inspections; Jags provides the platform (and optional setup/training/support). Client users get full working roles; Jags holds admin/support roles. This is the software/licensing model.
R5.  Hybrid (shared): Jags does some parts and the client does others (e.g. Jags builds ITPs and witnesses hold points; the client runs routine checklists). Roles are mixed as agreed.
R6.  Implementation: this is delivered by the roles & licensing system (each user's role controls what they can do) — there is no separate build per model. The admin sets the appropriate roles per client to achieve the chosen model.
### 3.0b Two Modes — ITP-driven and Standalone Assignment
QMP Inspect supports two ways of working. The user chooses the mode when starting work.
R7.  MODE 1 — ITP-driven (full lifecycle): plan (ITP) → checklists → execution → data book → handover. This is the full project QA workflow described in the rest of this document.
R8.  MODE 2 — Standalone Assignment (new): a single, specific scope of work with no full ITP or data book required — e.g. a Factory Acceptance Test (FAT), a specific witness inspection, a single test, or a pre-shipment inspection. The deliverable is the inspection/test REPORT. See 3.0a.
R9.  Both modes reuse the same underlying engine — checklists, AI drafting, NCRs/observations, signatures, reports, vault, registers and KPIs. A standalone assignment can later be expanded into a full ITP-driven project if the client's scope grows.
### 3.0a Standalone Assignment / FAT & Specific Inspection (Mode 2)
For clients who engage Jags to perform only a specific inspection or test (very common — e.g. a FAT on a crusher), without the full ITP lifecycle. The output report is the product.
R10.  Create a standalone assignment with: assignment type (FAT / witness inspection / specific test / pre-shipment inspection / other), client, the equipment or item being inspected (description, model, serial/tag number), location (e.g. vendor works), date, and the governing standard/spec reference.
R11.  Attach the relevant checklist to the assignment: pick from the checklist library, generate it from a spec/standard using the AI (the spec-to-checklist feature works here too), or build it in-app. Example: a FAT checklist for a crusher.
R12.  Conduct the inspection/test: work through the checklist (Yes/No/N-A + comments), record measurements and test results, capture photos, log any punch-list items or deviations, and capture the required signatures (Jags inspector, vendor, and client/witness where present).
R13.  Raise NCRs or observations for failures using the same engine as ITP-driven mode, with CAPA close-out.
R14.  Produce the deliverable as a professional, branded report — a FAT Report, Inspection Report, or Test Certificate as appropriate. The report must be first-class: equipment details, standard/spec reference, checklist results, measurements/test data, photos, punch list, a clear conclusion (Pass / Conditional Pass with punch list / Fail), and witness signatures. This report is the product the client receives.
R15.  The assignment and its report are numbered, stored in the client's vault, and feed the registers, KPIs and Power BI — so standalone work is fully traceable even without an ITP or data book.
R16.  Support 'conditional pass with punch list': the FAT passes subject to listed items being cleared; the assignment stays open until the punch list is closed, then a clearance/close-out is issued.
### 3.1 Projects & Setup
R17.  Create and manage client projects (client, site, details).
R18.  Set up per project: the parties involved (subcontractors, main contractor, TPI labs, vendors, client), the disciplines, and the document numbering scheme.
R19.  A shared per-client document folder with these areas: Drawings, Specifications, Standards & Codes, Material Submittals, RFIs, Method Statements, ITPs, Checklists & Forms, Approvals & Correspondence, Certificates, General Reference. It is shared across all that client's services.
R20.  FEEDING THE VAULT (manual upload is a known adoption barrier — provide easier options, in phases). Now: (a) bulk upload — drag-and-drop many files at once, or a folder/zip; universal and reliable. (b) Email-to-vault — a dedicated per-project email address; forwarded documents land in the vault (routed to a folder or a holding area to sort). Soon: (c) cloud folder sync with SharePoint / OneDrive (Jags already uses Microsoft 365) so a shared folder syncs into the vault. Phase 2: (d) direct connectors to the client's document systems (Aconex, Procore, ProjectWise) — these have restricted/paid partner APIs, so build per-system only when a client needs it.
R21.  Build the vault ingestion with a clean 'connector' structure from the start (documented stubs marked 'connect later' for Aconex, Procore, ProjectWise), so a future integration is a drop-in, not a rebuild.
R22.  Capture document control metadata on ingested documents: revision, date, source. When a document comes from an external system (Phase 2), keep its revision reference so the vault can stay in sync when the client revises it.
### 3.2 Inspection & Test Plans (ITPs)
R23.  Build ITPs with a three-phase structure: Development, Execution, Handover.
R24.  EDITABLE SECTIONS: an ITP is organised into sections (default examples: Submittals & Materials, Installation/Execution, Testing & Commissioning, Handover), but sections are NOT fixed. The user can ADD, DELETE, RENAME and REORDER sections freely to suit the discipline/industry (e.g. add 'Pre-Commissioning', 'Coating & Painting', 'Site Preparation'). Do NOT hard-code a fixed set of sections. Within each section the user can add, delete and reorder activities. When the AI generates an ITP from a spec it creates sensible sections automatically, which the user can then adjust.
R25.  Each ITP activity has: an evidence type (checklist, document upload, or measurement), acceptance criteria, reference (spec/standard/drawing), method/frequency, records required, and a notification period.
R26.  PER-PARTY INTERVENTION POINTS (important): an activity does NOT have one single point type. Instead, EACH party has its own intervention level for that activity, chosen from Hold (H), Witness (W), Review (R), Surveillance (S), or none. So the same activity can be, e.g., Hold for the Contractor, Witness for the Client, and Review for Jags, all at once.
R27.  Show this as a combined party grid on the ITP: one column per party, and each cell shows that party's intervention code (H/W/R/S colour chip) AND that party's sign-off for the activity. A blank cell means that party is not involved in that activity.
R28.  The parties are configurable per project (from the project party register), with a sensible default set of five columns: Contractor, Subcontractor, TPI/Lab, Jags, Client. The admin can hide parties that don't apply or add others.
R29.  Point-type legend on every ITP: H = Hold (work stops until released), W = Witness (party invited; may proceed if they don't attend within notice period), R = Review (records reviewed and accepted), S = Surveillance (routine monitoring, no hold).
R30.  The final ITP prints in landscape A4 so the party grid has room; keep the platform A4 print standards (repeating header/footer, clean page breaks).
R31.  Support a two-tier master library: Jags-owned master ITPs/checklists (internal IP, organised by industry and discipline) that are copied into a client project and then customised. The master is never changed by editing a client copy. Improvements can be proposed back to the master by deliberate admin approval (save-as-new / update / reject), with version history.
R32.  Tag each ITP and checklist to a discipline (Civil, Mechanical, Electrical, etc.) from a managed discipline list; the tag travels through copy and customisation.
R33.  Support repeatable activities: one activity template, many inspection instances per location, each with its own record and reference number.
### 3.2a Spec-to-ITP AI Generation (from the vault)
A key workflow: instead of building an ITP from scratch, the user selects a specification from the vault and the AI drafts an ITP from it. This is an AI-assist — the user reviews, edits and owns the final ITP.
R34.  From the document vault, the user selects a specification (e.g. an Electrical Specification) as the source for a new ITP.
R35.  The AI reads that specification AND cross-references the relevant industry standards/codes (e.g. ACI, IEC, ASME, ISO as applicable) to draft an ITP: activities, acceptance criteria, and references drawn from what the spec and standards actually require.
R36.  CONTROLLED OUTPUT (build the prompt into the app): the AI prompt used for ITP generation is written once by the developer and embedded in the application — the user never types a prompt, they click 'Generate ITP from specification'. The built-in prompt must CONSTRAIN the output so it is concise and field-usable, not exhaustive: enforce the standard section structure (default 4 sections; user can still add/delete/rename), a sensible limit of roughly 4–6 activities per section, include only items that genuinely need inspection/testing (skip definitions, background, general text), and combine minor items. The default output should be tight; the user can expand if needed.
R37.  For each drafted activity, the AI SUGGESTS the intervention level PER PARTY (e.g. Contractor = Hold, Client = Witness, Jags = Review) with a short reason; the user CONFIRMS or changes each one. The AI never finalises intervention points on its own.
R38.  The drafted ITP is fully editable — the user can add, delete, reorder and adjust any activity, criterion, reference or point type before accepting it.
R39.  From the same specification, the user can also generate the matching checklist(s); these are automatically linked to the relevant ITP activities (per the pre-linking requirement in 3.3).
R40.  The final ITP (and its checklists) can be downloaded as branded documents (PDF, and Excel where useful).
R41.  DRAFT OFFLINE ROUND-TRIP: after the AI drafts the ITP, the user can download the draft as an editable file (Excel/Word) to work on it offline, then upload the edited version back. IMPORTANT for traceability: the re-uploaded ITP re-enters the system as a DRAFT REVISION — it is validated (preview-and-check, like the Excel import) and must be reviewed and approved in-system before it becomes controlled/issued. The offline edit is for convenience; it never bypasses approval or the audit trail.
R42.  Everything the AI produces is clearly marked as AI-drafted and must be reviewed and approved by a named, qualified person before it is issued or downloaded — responsibility for the final ITP rests with that person, not the AI. Record who approved it.
R43.  The AI features are hidden cleanly if no AI API key is configured (the manual ITP builder still works).
### 3.3 Checklists & Forms
R44.  Provide an in-app checklist/form builder (as well as Excel import) for the team to create checklists and simple data-capture forms.
R45.  Every checklist item uses Yes / No / N-A plus a Comments/Notes field. Most items are a single tap; measured values (e.g. concrete results) go in Comments. A 'No' requires a comment and offers to raise an NCR or observation.
R46.  Pre-link a checklist to each ITP activity per client, so on site the correct checklist loads automatically — the inspector taps, not types. Per-client checklist sets are supported.
R47.  Allow download of blank ITP/checklist Excel templates and import of completed ones, with a preview-and-validate step before saving. (Actual inspections still run in the app to preserve signatures and traceability.)
### 3.3a Document-Linked Numbered Pack (ITP + its checklists & records)
The ITP and its records form one self-referencing controlled pack: every record in the Records/Evidence column carries its own controlled number that ties back to the parent ITP and activity.
R48.  When the AI drafts an ITP from a spec (3.2a) it also DRAFTS the checklist content for the activities that need them. The checklists are formally GENERATED, NUMBERED and LINKED at ITP APPROVAL (not at first draft) — so every checklist maps to a final, approved activity and gets a stable number, with no orphaned or renumbered checklists after edits.
R49.  On approval, each generated checklist is assigned its controlled number (tied to the parent ITP and activity, e.g. GFL-JAGS-CHK-001-2.1) and that number is written automatically into the Records/Evidence column of the matching ITP activity — so the ITP points to its checklists and the pack is complete and cross-referenced with no manual numbering.
R50.  COMPLETION ROLL-UP: an ITP activity is complete only when its linked checklist AND its required records (including any third-party 'expected → received' documents) are complete. The ITP shows a live completion % rolled up from its activities. The ITP is marked complete only when all linked checklists and required documents are complete. This single source of truth feeds the ITP register's '% complete', the client/KPI dashboards ('ITP completion %'), and the data book (which stays blocked until everything is complete).
R51.  Checklist numbering ties to the parent ITP using the configurable numbering engine, in a readable parent-encoded format: [client]-[originator]-CHK-[parent ITP sequence]-[activity], e.g. GFL-JAGS-CHK-001-2.1. The number is human-readable (self-identifying when printed/emailed) AND linked in the database to its exact parent ITP and activity.
R52.  Two-way link: from an ITP activity you can open its checklist; from a checklist you always know its parent ITP, activity, project and client. A checklist cannot be orphaned.
R53.  The checklist number flows through everywhere it appears: the Records/Evidence column, the checklist itself, the ITP register, the data book, and the Power BI views — fully traceable.
R54.  Records/Evidence per activity is a live list of the expected records, each showing: what the record is, who provides it (Jags / TPI / Contractor), its number, and its status (pending / received). Three kinds of record are handled differently:
R55.    (a) Jags checklists and Jags reports (IRN, inspection report): auto-generated and auto-numbered by the system, controlled.
R56.    (b) Third-party test records/reports (e.g. TPI lab test certificate, mill cert): shown as 'expected → received'. At ITP creation the record is listed with its provider and the number left BLANK (pending). When the third party issues it, the actual document number is entered and the file uploaded; the system then links it to the activity and marks it received. Auditors can instantly see which expected records are still outstanding.
R57.    (c) Other system reports: numbered like checklists.
### 3.3b Mobile & Offline Access
The platform must work well on phones and tablets — the field team depends on it. Access is via one web address for everyone; no app store is required.
R58.  Responsive design: the same web application works on desktop, tablet and phone. Build the field screens (checklists, inspections) mobile-first with large touch targets, readable outdoors.
R59.  Progressive Web App (PWA): the app can be 'installed' to a phone/tablet home screen from the browser (no app store), opening full-screen like a native app. This is the primary mobile experience, especially for field inspectors.
R60.  Offline capability for the field: inspectors can open activities, complete checklists, capture photos and sign while offline (poor/no signal on site); the app syncs automatically when connectivity returns. Nothing is lost offline.
R61.  Same access model everywhere: one URL serves desktop, mobile browser and installed PWA. Access is always controlled by login and role — a client only ever sees their own data, on any device. Jags field inspectors typically install the PWA to their home screen; clients usually use the browser (installing is optional for them).
R62.  Native app-store apps (Apple App Store / Google Play) are a PHASE 2 option only — pursue them only if a client requires it or for marketing presence. The responsive + PWA + offline approach covers the field need without app-store cost, delay, or ongoing review.
### 3.4 Conducting Inspections
R63.  Record inspections on site (tablet-friendly, large touch targets, works offline where possible): results, evidence photos, and a digital signature.
R64.  Every checklist and report carries a full traceability header (project, client, ITP reference, location, drawing revision, spec, standard, date, inspector), frozen at the time of inspection.
R65.  Generate an Inspection Release Note (IRN) when an activity passes.
### 3.5 Multi-Discipline & Multi-Party Workflow
R66.  Support multi-discipline sign-off: each discipline (e.g. CSA, MEP) prepares and verifies its own section; a hold point releases only when all required disciplines have verified. Disciplines are notified automatically when another's part is ready.
R67.  Support a configurable multi-party inspection chain per activity: e.g. Subcontractor (originator) → Main Contractor → TPI Lab → Jags → Client. Each party signs their step; the next party is notified automatically. The sequence can be strict (order enforced — for hold points) or flexible (any order — for routine items), configurable per activity.
R68.  Track vendor/subcontractor performance (first-time pass rate, NCRs, responsiveness) and make it visible to the client for their own project.
### 3.5a Approvals & Notifications (ITPs vs checklists)
ITPs and checklists are approved differently. This reflects real project practice.
R69.  ITPs require FORMAL approval before work proceeds: Prepared → Reviewed → Approved (Jags), then Client acceptance. An ITP is revision-controlled; an unapproved ITP has no authority. Record each approval with name and date.
R70.  Checklists / inspections are NOTIFICATION-based, and whether a party's response holds the work is driven by that party's intervention level for the activity (the per-party grid):
R71.    Hold (H): work is genuinely held for that party until they respond/release. A hold point must wait.
R72.    Witness (W): notify-and-proceed. The party is notified; if they do NOT respond within the notice period, work is NOT held — the originator may proceed at their discretion.
R73.    Review (R) / Surveillance (S): never hold progress — records are reviewed afterwards, or the activity is monitored, without stopping work.
R74.  When a witness party is notified and does not attend within the notice period and the originator proceeds, the system RECORDS it clearly: 'Party X notified [date/time]; no response within notice period; proceeded at originator's discretion.' This protects traceability and all parties in any dispute.
R75.  Notifications route to the relevant parties for the activity (e.g. main contractor → subcontractor / vendor / lab) automatically, based on the per-party grid and the multi-party chain.
R76.  ORIGINATOR RAISES THE CALL: for a hold or witness point, the originator (typically the subcontractor/contractor) raises the inspection request/notification when work is ready or approaching that point. The system then notifies the parties who have an intervention on that activity (and Jags), so they can attend.
R77.  CONFIGURABLE NOTICE PERIOD: the notice period for hold and witness points (e.g. 24h / 48h / 72h) is configurable per client and per project, and may differ by point type (e.g. Hold = 48h, Witness = 24h). The system uses it to timestamp the notification, run a visible countdown, and enforce the witness 'notify-and-proceed' rule (a witness point may proceed only once the notice period has elapsed with no attendance; the non-attendance is recorded). A Hold point always waits for release regardless of elapsed time.
R78.  Show the notice period and the countdown/status clearly on the activity and in the notification, so all parties know how long they have to respond. Overdue responses escalate (reminders/alerts).
R79.  CONFIGURABLE APPROVAL WORKFLOW per client (with per-project override): the approval chain for ITPs is not fixed. The team defines, for a client, who Prepares, who Reviews, who Approves, and who gives final Acceptance — and this can differ by engagement mode. On a Jags-led engagement the chain runs through Jags then client acceptance; on a client-led / white-label engagement the client's own team performs the internal approvals in their own portal view, with Jags positioned in the chain as agreed. Configure the checklist notification/approval behaviour separately from the ITP approval chain (checklists remain notification-based per 3.5a).
R80.  EXTERNAL APPROVAL (when a client's formal approval must happen in their own system, e.g. Aconex / ProjectWise / their DMS): support the flow — QMP internal approval is completed → the controlled ITP PDF is downloaded → the user submits it to the client's external portal → when the client approves there, the user records the EXTERNAL APPROVAL REFERENCE (transmittal/approval number and date) back in QMP against that ITP. QMP therefore holds the complete record ('approved externally by client, ref, date') even though the approval occurred in the client's system.
R81.  QMP complements, not replaces, a client's external approval system. Do not force external contractual approval into QMP; QMP builds and internally approves the ITP and records the external approval. Phase 2 (only if a client needs it): a direct transmittal connector to push the ITP out and pull the approval back automatically — build per-system when justified, using the connector-ready structure.
### 3.6 NCRs & Observations
R82.  At the point an inspection fails, let the inspector choose: Observation, Minor NCR, or Major NCR — one engine, graded by severity.
R83.  Provide full NCR management: description (AI can draft), requirement, severity, assignment to a party with a due date, corrective/preventive action (CAPA), Jags verification, and close-out with a certificate. Observations are lighter and can be escalated to an NCR.
R84.  Provide live NCR and Observation registers with totals and statistics (open, overdue, closed, aging, by contractor/discipline).
### 3.7 Data Book, Handover & KPIs
R85.  Auto-compile the project Data Book (the full quality record) and block completion until all required items are verified.
R86.  PUNCH-LIST GATE: the Data Book cannot be marked complete or issued while any punch-list item is open — it shows 'X punch items open — must be closed before handover', the same way it blocks on unverified items. Likewise handover cannot complete with open punch items.
R87.  CONDITIONAL HANDOVER EXCEPTION: a senior/authorised user may issue a 'Conditional Handover with open punch list' as a deliberate, documented, approved exception — the open items are listed on the handover certificate, with responsible parties and due dates, and the client accepts on that basis. This mirrors the FAT 'conditional pass'. Default behaviour is to block; the exception is explicit and recorded (who approved, when, and the open items).
R88.  Support service-by-service handover, with all of a client's services shown in one client portal; the client receives the handover through the portal.
R89.  Provide a client KPI dashboard with at least: first-time pass rate, hold-point turnaround, NCR close-out, data-book readiness, inspections completed vs planned, and ITP completion %.
R90.  The client dashboard shows the client THEIR project only: the headline KPIs above; their open items (hold points awaiting them, ITPs to accept, NCRs on their side); their vendor/subcontractor performance; a progress trend; recent and upcoming inspections; and access to download their documents and reports. It must NEVER show Jags internal costs, margins, other clients' data, or the Jags internal Power BI.
### 3.7a Registers
R91.  Provide an exportable ITP Register: a live list of all ITPs across projects/clients showing status (draft / issued / superseded), revision, discipline, % complete, and open items. Filterable and exportable to PDF and Excel — alongside the NCR and Observation registers.
### 3.7c Vault-Generated Live Registers
Beyond storing documents, the vault actively generates live registers from its folders — the same AI-assisted pattern as Spec-to-ITP. Registers stay current as documents are added and flag expiries/status.
R92.  Calibration Register (from the Calibration Certificates folder): instrument/equipment, cert number, calibration date, DUE DATE, status. Flags instruments due within 30/90 days (amber) or overdue/expired (red).
R93.  Welder Qualification Register (from the Welder Qualifications folder): welder ID/name, qualified WPS/PQR, qualified ranges (process, position, thickness, material group), qualification/continuity expiry, status. Flags expiring/expired qualifications.
R94.  Material Register (from the Material Submittals folder): material, submittal reference, approval status (e.g. A / B / C / D coding), approved date, status. Shows what is approved for use.
R95.  Project Punch-List Register (one central register per project): the running list of open items that must be closed before handover. Punch items flow in from MULTIPLE sources — inspection failures, FAT conditional-passes, NCRs, and the final walk-down — into this one register. Each item has: description, source (which inspection / FAT / NCR / walk-down raised it), location, responsible party, due date, status (open/closed), and closing evidence.
R96.  Registers are LIVE views (not one-time snapshots) that update as documents are added or expire; they are exportable (PDF/Excel), feed the data book and KPIs, and are fully traceable. Generating a register uses the AI/parse pattern: read the folder's documents and build the register, with a person confirming the parsed data.
### 3.7d Register-Fed ITP Verification (auto-check)
The registers feed back into ITP verification — a genuine conformance safeguard. This is a flagship capability.
R97.  When an ITP activity involves a material, instrument, or welder, the system checks it against the relevant register: Material Register (is the material approved?), Calibration Register (is the instrument in-calibration?), Welder Register (is the welder qualified for this weld?).
R98.  AUTO-FILL + CONFIRM: if the check passes, the system auto-fills the verification record on the activity (e.g. 'Material approved — submittal ref X', 'Gauge G-102 in-cal, cert Y, due Z', 'Welder W-14 qualified WPS-3'); a qualified inspector CONFIRMS it. The system suggests, the human confirms — never auto-locked without confirmation.
R99.  SOFT STOP on non-conformance: if the material is not approved / instrument out-of-cal / welder not qualified, the system WARNS clearly but allows the inspector to proceed after entering a reason. The warning and the reason are recorded on the activity for traceability (it is not a hard block).
R100.  These auto-checks and their outcomes are captured in the record, feed the NCR engine where appropriate, and appear in the data book and audit trail — so conformance of materials, calibration and welder qualifications is demonstrable at audit.
### 3.7b Revisions, Audit Log & Traceability
R101.  Every ITP has a revision (Rev A, Rev 0, Rev 1…). An issued revision is frozen and can never be silently changed — any change creates a new revision. Each ITP carries a visible Revision History table (rev, date, description of change, by whom).
R102.  Maintain an audit log that records every create, edit, approval, issue and status change with the person's name and timestamp — available for client audits.
R103.  Full traceability up and down the chain: ITP → activity → checklist / test record → inspection record → NCR → governing drawing revision → project → client.
### 3.8 Documents & Numbering
R104.  Configurable document numbering per client (with optional per-project override): a format built from blocks (client code, originator, doc type, discipline, sequence, revision, year, separator), e.g. GFL-JAGS-ITP-001-Rev0. Numbers are unique, never reused, frozen on the record, and sequences count separately per document type.
R105.  Provide a document traceability view: any document number traces its full lineage (e.g. NCR → inspection → ITP activity → location → governing drawing revision → client).
R106.  Printable outputs are A4 with repeating header/footer. IMPORTANT: the activity table flows continuously across pages — do NOT force a page break after each section; only break when the page is full, and keep a section header with at least its first activity row (no stranded headings). The ITP prints landscape A4.
R107.  Client download in three formats: PDF, Word, and Excel. PDF is the CONTROLLED, official issued document. Word and Excel exports are for the client's convenience (markup / data re-use) and must be watermarked/labelled 'UNCONTROLLED COPY — for information / markup only' so they cannot be mistaken for the official record. This protects the audit trail.
### 3.9 Reports, Power BI & AI
R108.  Generate branded PDF reports (ITP, inspection, IRN, data book, etc.) and Excel exports, to the platform report standard.
R109.  Provide a monthly client report pack (PDF + Excel) per client, covering all services they are licensed for.
R110.  Expose secure read-only reporting views for the Jags-internal Power BI (all clients, all projects) — including inspections completed vs planned, ITP completion %, hold-point turnaround, first-time pass rate, and NCR trends. Clients do not get live BI — they get the report packs.
R111.  Provide AI assists (Anthropic Claude API). All AI DRAFTS or SUGGESTS; a qualified person reviews, edits and approves before anything is used or issued. Hidden cleanly if no API key is set. The assists include: generate a draft ITP from a spec + standards (3.2a); draft NCR and observation wording; draft inspection narratives, ITP executive summaries and report conclusions; grammar/clarity clean-up of field notes; translation between languages (e.g. English/Arabic/Hindi) for multi-national teams; suggest acceptance criteria and checklist items from a standard; suggest likely root causes for an NCR; summarise inspection history, a data book, or a month's activity; consistency checks (flag a checklist result that contradicts its acceptance criteria, or an NCR missing information); and an 'ask your project' assistant answering plain-language questions from the user's own data.
### 3.10 Platform, Licensing & Branding
R112.  Multi-tenant: each client is a tenant; the home screen shows only the modules the client is licensed for.
R113.  Configurable client branding per client: co-brand (client logo + 'Powered by Jags Assurance', default) / Jags-only / white-label (client only). Applies to app header, login, client portal and reports (client logo in report header; Jags credit in footer for co-brand).
### 3.10a Engagement Mode (branding + numbering together)
Branding and document numbering depend on whose engagement it is. A single 'engagement mode' setting drives BOTH, so the team sets it once and every document follows.
R114.  Provide an 'engagement mode' set PER CLIENT (applying to all their projects), with an optional per-project override. The three modes and what each drives:
R115.    Jags-led: Jags logo and branding + Jags document numbering (e.g. GFL-JAGS-ITP-001).
R116.    Co-branded: client logo + 'Powered by Jags Assurance' + numbering configurable (Jags numbering by default, or the client's if they prefer).
R117.    White-label (client-led): client logo only, no Jags mark + the CLIENT'S OWN document numbering format, fully configurable to match their existing document control (e.g. MEH-EL-ITP-0001). The 'originator' block becomes the client's code instead of JAGS.
R118.  The one engagement-mode choice sets both the branding treatment AND the numbering scheme automatically for everything the platform generates (ITPs, checklists, NCRs, reports) — no per-document configuration.
R119.  White-label numbering must be fully configurable (blocks, separators, padding, prefixes) so it conforms to the client's mandated convention, which the client dictates — Jags matches it.
R120.  TRACEABILITY SAFEGUARD: on white-label (and co-brand using client numbering) jobs, the platform still keeps a hidden Jags internal reference linked behind the client's visible number, so Jags can always trace and audit the work as its own (for Jags records, quality system, and Power BI). The client sees their number on documents; Jags retains its internal reference in the background.
# 4. Key Workflow — End to End
The core end-to-end process the module must support, so the pieces connect correctly.
[TABLE]
Stage | What happens
0 · Setup | Jags sets up the client, document numbering, parties, disciplines; uploads drawings/specs to the shared client folder.
1 · Development | Jags copies a master ITP into the client project, customises it, pre-links checklists, sets the sign-off chains. The client reviews and accepts the ITP.
2 · Execution | Subcontractor self-inspects (originator) → Main Contractor reviews → TPI Lab tests/uploads → Jags witnesses and signs the IRN, or raises an NCR. Parties are notified automatically; multi-discipline hold points lock until all verify.
3 · Handover | Jags compiles the data book, the completeness check passes, each service is handed over, and the client receives it through the portal.
[/TABLE]
# 5. UI & Design Preferences
The look and feel matter — clients use this, so it represents Jags. Follow the brand exactly; the layout specifics below are preferences, and the clickable prototypes show the intended screens.
### Brand (exact)
- Burgundy #6B1E2C — sidebar, headers, primary buttons.
- Gold #F5C518 — active states, highlights, key actions.
- Off-white #F9F7F4 background; near-black #1C1C1E text.
- Font: Inter (Google Fonts) — in the app and in PDF reports.
### Layout preferences
- Burgundy left sidebar with the Jags logo top-left; clean, modern, professional enterprise feel — rounded cards, subtle shadows, generous spacing.
- A home screen ('orbit hub') showing the platform modules; only licensed modules active. Responsive: an orbit layout on laptop/tablet, a card grid on phone.
- Tablet-friendly field screens: large touch targets (min ~44px), simple tap interactions, readable in bright conditions.
- Colour-code consistently: pass/available green, warning/amber, fail/overdue red, info blue.
[TABLE]
ℹ  Use the prototypes | Ask Naresh for the clickable QMP Inspect prototypes. They show the dashboard, ITP, | checklist, multi-discipline sign-off, party chain, NCR, registers, KPI dashboard, | handover and reports. Treat them as the visual target for layout and feel — | they are mockups, not code.
[/TABLE]
# 6. Rules & Constraints (Non-Negotiable)
R121.  Per-client data isolation is absolute — clients log in; none may ever see another's data.
R122.  AI assists only — it drafts; a qualified person reviews and signs. Never let AI make or sign off a quality decision.
R123.  Jags never represents that it provides professional engineering or engineering design services — no screen, report or template may state or imply this. It cannot be overridden by any client instruction or job description.
R124.  Document numbers, once issued, are unique, never reused, and frozen on the record.
R125.  Governing drawing/spec revisions are frozen onto a record at the time of inspection.
R126.  Security before go-live: HTTPS, encryption at rest, audit logging, backups, secrets in environment variables — see the Production Readiness guide.
### Integrations
- Anthropic Claude API for AI assists (assist-only).
- Secure read-only views for Jags Power BI.
- Excel import/export (ITP and checklist templates, report data).
[TABLE]
✓  Definition of done for QMP Inspect | All functional requirements met and per-client isolation verified. | The end-to-end workflow (setup → development → execution → handover) works. | Brand and Inter font correct throughout; screens match the prototypes' intent. | Reports (PDF + Excel) and the monthly pack generate correctly. | AI assists work and are hidden when no key is set. | The non-negotiable rules above are all honoured.
[/TABLE]
Build it your way with Claude — this document is the 'what', the 'how' is yours.
JAGS ASSURANCE  ·  jagsassurance.com