JAGS ASSURANCE
Quality Management Platform (QMP)
PLATFORM ARCHITECTURE
Overview for the Development Team
How many applications, what each does, and how they work together
Read this before the module requirements
Version 1.1  ·  06 Sep 2026  ·  For the QMP developer  ·  Confidential
# Document Control — Revision History
This document is version-controlled. The current version is on the cover; each change is recorded below.
[TABLE]
Rev | Date | Description of change
1.0 | (initial) | Initial platform architecture overview — 10 modules, how they connect, platform standards.
1.1 | 06 Sep 2026 | Updated QMP Inspect description to reflect two modes (ITP-driven and standalone FAT/specific inspection) and latest refinements.
[/TABLE]
# 1. The Big Picture
Jags Assurance is a global quality-compliance consultancy offering 11 services (audits, inspection, ISO readiness, resource staffing, and so on). The Quality Management Platform (QMP) is our own software platform that delivers these services digitally, instead of using spreadsheets and email.
QMP is not one large application. It is a family of focused modules — each a web application in its own right — that share one look, one login, and one data foundation, and appear to the user as a single connected platform.
[TABLE]
ℹ  The one-line summary | 10 modules. One platform. Shared login, shared design, shared data foundation. | Each module handles one area of quality work. A client only sees the modules | they are licensed for. Jags staff work across them.
[/TABLE]
### What is being built, in what order
- QMP Inspect — field inspection (the flagship, being built first).
- QMP Resource — the resource/bench module (built next; internal-only).
- QMP Audit — audit management (built third; used by most services).
- Then: Comply, Improve, ISO, PreQual, Train, Surveillance (specified later, as needed).
# 2. The 10 Modules — What Each One Is
Each module is a web application focused on one area. Here is the full set, roughly in order of how many services depend on it.
[TABLE]
# | Module | Client-facing? | What it does
1 | QMP Inspect | Yes | Field inspection in two modes: full ITP-driven lifecycle (hold points, checklists, NCRs, data book, KPIs) AND standalone assignments (FAT, specific inspections/tests with report as deliverable). Being built first.
2 | QMP Resource | No (internal) | The resource bench: candidates, disciplines, availability, rates, matching, placements. Jags-only.
3 | QMP Audit | Yes | Internal / supplier / external / ISO-readiness audits, findings, corrective actions, reports.
4 | QMP Comply | Yes | Compliance layer: tracks standards, codes and obligations across services (used by 9 services).
5 | QMP Improve | Yes | The CAPA engine: root cause, corrective & preventive actions, improvement tracking.
6 | QMP ISO | Yes | Quality manual, ISO clause mapping, procedure library, certification readiness.
7 | QMP PreQual | Yes | Supplier pre-qualification and the Approved Supplier List.
8 | QMP Train | Yes | Training records, competency and certification tracking.
9 | QMP Surveillance | Yes | Vendor/site surveillance. Separate module; shares the NCR engine with Inspect.
10 | (future / support) | — | Corporate-QMS support and any additional modules as the platform grows.
[/TABLE]
[TABLE]
⚠  QMP Resource is the exception — internal only | Every other module has a client side. QMP Resource does NOT — it is used only by | the Jags team and holds commercial data (costs, margins). Never expose it to clients.
[/TABLE]
# 3. How the Modules Work Together
The modules are separate applications, but they are designed as one platform. Three things tie them together, and several data flows connect them.
### The shared foundation (build once, reuse across modules)
- One login & user system — a person logs in once; their role decides what they see.
- One design system — the same brand, layout, components and Inter font everywhere.
- One home screen (the 'orbit hub') — shows the modules; only licensed ones are active.
- One client & licensing model — each client is a tenant; they see only their licensed modules and only their own data (strict per-client isolation).
- One reporting standard — branded PDFs + Excel, and secure read-only views for Jags Power BI.
- One client-branding setting — co-brand / Jags-only / white-label, per client.
### How data flows between modules
[TABLE]
Connection | What flows
Inspect ↔ Surveillance | Share the NCR (non-conformance) engine when a client has both.
Audit → Improve | Audit findings feed corrective actions (CAPA) in QMP Improve.
Audit → PreQual | Supplier audit scores feed supplier pre-qualification.
Resource → all services | Supplies the qualified people who deliver every service (Service 11 + support).
Comply → most modules | Provides the standards/obligations context used across services.
All modules → Power BI | Each exposes secure read-only views to the Jags internal command centre.
Shared client folder | One document store per client, shared across all that client's services/modules.
[/TABLE]
[TABLE]
💡  Practical implication for the build | Build QMP Inspect first as a complete, standalone module — but keep the shared | foundation (auth, design system, client/licensing model, reporting) clean and | reusable, because the next modules will reuse it. Don't hard-wire anything to | Inspect that the platform will need to share.
[/TABLE]
# 4. Technical Architecture (Your Territory)
You own the technical decisions. This section states the intent and the few platform-wide standards that keep the modules consistent — the 'how' is yours to design with Claude.
### Suggested shape (not mandatory — your call)
- Each module is a web application (the reference build uses React + Tailwind on the front end and Node/Express on the back end — you may choose otherwise, but consistency across modules helps).
- Development database can be simple (e.g. SQLite); production should be PostgreSQL — see the Production Readiness guide.
- Files/photos/evidence in cloud object storage for production (not local disk).
- PDF reports generated server-side; Excel via a spreadsheet library.
- AI features via the Anthropic Claude API (assist-only; human approves).
### Platform-wide standards (please keep these consistent across modules)
[TABLE]
Standard | Expectation
Multi-tenant isolation | Every record is tied to a client; a client can never see another client's data. This is critical — clients log in.
Roles & access | Role-based access (Jags admin, Jags staff, client, and party roles like subcontractor). People see only what their role allows.
Brand & design | Burgundy #6B1E2C, Gold #F5C518, off-white #F9F7F4, text #1C1C1E, Inter font — identical across modules.
Reporting | Branded PDF + Excel; secure read-only views for Jags Power BI; clients get report packs, not live BI.
Client branding | Per-client mode: co-brand (default) / Jags-only / white-label — affects header, login and reports.
AI | Assist-only. AI drafts; a qualified person reviews and signs. Hidden if no API key.
Security (before go-live) | HTTPS, encryption at rest, audit logging, backups — see Production Readiness guide.
[/TABLE]
[TABLE]
⚠  The absolute rule (all modules) | Jags Assurance never offers or represents professional engineering or engineering | design services. Nothing in any module should describe Jags as providing regulated | engineering. This cannot be overridden by any client instruction or job description.
[/TABLE]
# 5. How We Work & Your Documents
You build with Claude in whatever way suits you. For each module you will get a Requirements & Specification document (like the QMP Inspect one accompanying this) describing what it must do, the users and roles, the workflows, the data, the UI preferences, and the rules — written as requirements, not step-by-step prompts. How you build it is yours.
### Reference material available to you
- Requirements & Specification per module (QMP Inspect first).
- Interactive prototypes — clickable mockups showing the intended screens and flows (ask Naresh for the prototype links; they show layout and look, not final code).
- The aligned Service Catalogue — full business detail of each service, for context.
- The Production Readiness guide — what must be true before real clients use it.
- Prompt-style build guides also exist (written for a non-technical builder). You do not need to follow them prompt-by-prompt — treat them as an extra, very detailed reference if you ever want the fine-grained specifics behind a requirement.
[TABLE]
✓  What we need from the platform, in priority order | 1. Correct, per-client-isolated, secure (clients log in). | 2. Faithful to the workflows and rules in the requirements docs. | 3. Consistent brand and design across modules. | 4. Built so the shared foundation is reused by later modules. | The exact tech and structure are your decisions.
[/TABLE]
Start with QMP Inspect. The big picture above is the context; the requirements doc is the detail.
JAGS ASSURANCE  ·  jagsassurance.com