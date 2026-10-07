// Renders the printable HTML for a project's Data Book (R86, R108) in the Jags Assurance Data Book
// reference layout (Jags_Assurance_Data_Book_Reference.pdf), in the reference's order:
//   Part A  Document control — cover, control & authorization, revision/distribution/status,
//           contents, scope and terminology
//   Part B  Evidence register — master record register (one row per ITP activity record) + totals
//   Part C  Records — per-ITP inspection & test records, then materials, welding, calibration,
//           nonconformance, punch list / completion
//   Part D  Release controls — readiness & hard gates, final completeness certification,
//           final acceptance & handover
// The same template renders every issue state: a Draft/compiled book carries a DRAFT watermark and
// "NOT READY"/unsigned wording until the book is issued; an issued book reads FINAL. Everything is
// real project data — nothing here is illustrative placeholder text. Readiness figures mirror
// apps/web/lib/databook/readiness.ts (the worker can't import it — see renderDataBookPdf.ts).

export interface DataBookPdfCategory {
  label: string;
  ready: number;
  total: number;
  percentage: number;
}

/** R88 — one row of the "Breakdown by service / discipline" table, mirroring
 *  apps/web/lib/databook/discipline-breakdown.ts's DataBookDisciplineRow exactly. */
export interface DataBookPdfDisciplineRow {
  disciplineCode: string;
  disciplineName: string;
  itpCount: number;
  ncrCount: number;
  firstAttempts: number;
  firstTimePasses: number;
  firstTimePassRate: number | null;
}

export type DataBookRecordState = "Accepted" | "Accepted with comments" | "In review" | "Draft" | "Rejected" | "Missing";

export interface DataBookPdfIntervention {
  code: string;
  partyName: string;
  status: string;
  signedBy: string | null;
  signedAt: string | null;
}

export interface DataBookPdfActivity {
  itemNumber: string;
  activity: string;
  criteria: string | null;
  reference: string | null;
  method: string | null;
  interventions: DataBookPdfIntervention[];
  recordNumber: string | null;
  result: string | null;
  inspectionDate: string | null;
  inspector: string | null;
  irnNumber: string | null;
  state: DataBookRecordState;
}

export interface DataBookPdfItp {
  itpNumber: string;
  title: string;
  revision: number;
  status: string;
  phase: string;
  standard: string | null;
  preparedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
  activities: DataBookPdfActivity[];
}

export interface DataBookPdfCalibration {
  instrument: string;
  certNumber: string;
  calDate: string | null;
  dueDate: string;
  status: string;
}
export interface DataBookPdfWelder {
  welder: string;
  wps: string;
  ranges: string | null;
  expiry: string;
  status: string;
}
export interface DataBookPdfMaterial {
  description: string;
  heat: string | null;
  batch: string | null;
  po: string | null;
  certificate: string | null;
  approval: string;
  receipt: string;
  supplier?: string | null;
  quantity?: string | null;
  releasedAt?: string | null;
}
export interface DataBookPdfPersonnel {
  name: string;
  certification: string;
  certNumber: string | null;
  expiry: string;
  status: string;
}
export interface DataBookPdfStandalone {
  number: string;
  type: string;
  equipment: string;
  date: string | null;
  conclusion: string;
  clearance: string;
}
export interface DataBookPdfNcr {
  number: string;
  description: string;
  severity: string;
  status: string;
  closedAt: string | null;
  closedByName?: string | null;
  rootCause?: string | null;
  correctiveAction?: string | null;
  preventiveAction?: string | null;
  verificationNotes?: string | null;
  evidenceCount?: number;
}
export interface DataBookPdfPunch {
  description: string;
  location: string | null;
  status: string;
  dueDate: string | null;
  closedAt: string | null;
  priority: string | null;
  source: string | null;
  responsibleParty: string | null;
  closingEvidence: string | null;
  verificationNotes: string | null;
  verifiedBy: string | null;
}

/** "Rev n" label for the book itself (shared by body and footer). */
export function formatBookRevision(revision: number | string | null | undefined): string {
  const n = Number(revision);
  return `Rev ${Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0}`;
}

function bookRevLabel(data: { bookRevision?: number }): string {
  return formatBookRevision(data.bookRevision);
}

export interface DataBookPdfData {
  bookNumber: string;
  /** data_books.revision (numeric); printed as "Rev n". Defaults to 0 when absent. */
  bookRevision?: number;
  title: string;
  status: "draft" | "compiled" | "issued";
  projectName: string;
  projectNumber: string;
  organizationName: string | null;

  /** The gating categories, in display order — same set readiness.ts's `isReady`/`overallPercentage`
   *  are computed from. */
  categories: DataBookPdfCategory[];
  /** Informational only, excluded from overallPercentage. */
  handoverCertificate: DataBookPdfCategory;
  disciplineBreakdown: DataBookPdfDisciplineRow[];
  openPunchItems: number;
  overallPercentage: number;
  isReady: boolean;

  compiledAt: string | null;
  compiledBy: string | null;
  overrideReason: string | null;
  overrideBy: string | null;

  itps: DataBookPdfItp[];
  /** Project site / location text, and the parties on the project (for the distribution register). */
  siteLocation: string | null;
  parties: { name: string; partyType: string }[];
  calibrations: DataBookPdfCalibration[];
  welders: DataBookPdfWelder[];
  materials: DataBookPdfMaterial[];
  personnel?: DataBookPdfPersonnel[];
  standalone?: DataBookPdfStandalone[];
  ncrs: DataBookPdfNcr[];
  punchItems: DataBookPdfPunch[];

  generatedAt: Date;
  /**
   * Drives the letterhead/footer per the organisation's engagement_mode (Reqs R113-R118) — see
   * orgBranding.ts. Optional/undefined renders exactly as jags_led (today's unchanged branding).
   */
  branding?: DataBookPdfBranding;
}

export interface DataBookPdfBranding {
  engagementMode: "jags_led" | "co_branded" | "white_label";
  logoUrl: string | null;
  /** The organisation's own colours (co-branded / white-label only); replace the default navy table headers. */
  brandPrimaryColor?: string | null;
  brandAccentColor?: string | null;
}

const ISSUE_PURPOSE: Record<DataBookPdfData["status"], string> = {
  draft: "Draft",
  compiled: "For Review",
  issued: "Final",
};

/** Footer/header wording — also used by renderDataBookPdf.ts for the Puppeteer page footer. */
export function dataBookIssueLabel(status: DataBookPdfData["status"], conditional = false): string {
  if (status === "issued") return conditional ? "FINAL — CONDITIONAL HANDOVER" : "FINAL";
  return status === "compiled" ? "FOR REVIEW — NOT ISSUED" : "DRAFT — NOT ISSUED";
}

/** An issued book that was compiled with outstanding items is a Conditional Handover, never an unqualified Final. */
function issuePurpose(data: Pick<DataBookPdfData, "status" | "overrideReason">): string {
  return data.status === "issued" && data.overrideReason ? "Final — Conditional handover" : ISSUE_PURPOSE[data.status];
}

/** minor_ncr -> "Minor NCR". Observations stay out of readiness and the open-NCR exceptions count. */
function severityLabel(severity: string): string {
  if (severity === "major_ncr") return "Major NCR";
  if (severity === "minor_ncr") return "Minor NCR";
  if (severity === "observation") return "Observation";
  return severity.replace(/_/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cell(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "&mdash;" : escapeHtml(String(value));
}

import { fmtDmy } from "./registerStatus";

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

function table(headers: string[], rows: string[][], widths?: string[]): string {
  const head = headers.map((h, i) => `<th${widths?.[i] ? ` style="width:${widths[i]}"` : ""}>${escapeHtml(h)}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `<table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function page(id: string, part: string, title: string, intro: string | null, body: string): string {
  // `.mk` is an invisible 1px marker: the renderer reads it back from a first-pass PDF to learn which
  // physical page each section starts on, so the contents page can print real page numbers.
  return `
  <section class="page" id="${id}">
    <span class="mk">§${id}§</span>
    <div class="part">${escapeHtml(part)}</div>
    <h1>${escapeHtml(title)}</h1>
    ${intro ? `<p class="lead">${escapeHtml(intro)}</p>` : ""}
    ${body}
  </section>`;
}

function signLines(prepared: string | null, preparedAt: string | null, reviewed: string | null, reviewedAt: string | null, approver: string | null): string {
  return `
    <p class="sign">
      Prepared or performed by: <b>${cell(prepared)}</b> &nbsp; Date: <b>${fmtDate(preparedAt)}</b><br />
      Reviewed by: <b>${cell(reviewed)}</b> &nbsp; Date: <b>${fmtDate(reviewedAt)}</b><br />
      Approver: <b>${approver ? escapeHtml(approver) : "Not performed"}</b>
    </p>`;
}

const STATE_CLASS: Record<DataBookRecordState, string> = {
  Accepted: "ok",
  "Accepted with comments": "ok",
  "In review": "warn",
  Draft: "warn",
  Rejected: "bad",
  Missing: "bad",
};

function stateBadge(state: DataBookRecordState): string {
  return `<span class="state ${STATE_CLASS[state]}">${escapeHtml(state)}</span>`;
}

function distinct(values: Array<string | null | undefined>): string | null {
  const v = [...new Set(values.filter(Boolean) as string[])];
  return v.length ? v.join(", ") : null;
}

const JAGS_BRAND_BLOCK = '<div class="brand-mark">JA</div><div class="wordmark">JAGS ASSURANCE<small>QMP INSPECT</small></div>';

/** See ncrTemplate.ts's renderBrandBlock — identical semantics. */
function renderBrandBlock(data: DataBookPdfData): string {
  const mode = data.branding?.engagementMode ?? "jags_led";
  const logoUrl = data.branding?.logoUrl ?? null;
  if (!logoUrl) return JAGS_BRAND_BLOCK;

  const orgLogo = `<img class="org-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  if (mode === "white_label") return orgLogo;
  if (mode === "co_branded") return `${JAGS_BRAND_BLOCK}<img class="org-logo org-logo-co-branded" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  return JAGS_BRAND_BLOCK;
}

function renderPoweredByFooter(data: DataBookPdfData): string {
  if ((data.branding?.engagementMode ?? "jags_led") !== "white_label") return "";
  return '<div class="powered-by">Powered by JAGS Assurance</div>';
}

export function buildDataBookPdfHtml(data: DataBookPdfData, pageMap: Record<string, number> = {}): string {
  const issueLabel = dataBookIssueLabel(data.status, !!data.overrideReason);
  const generatedAtLabel = data.generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const issueDate = fmtDate(data.compiledAt ?? data.generatedAt.toISOString());
  const projectLabel = `${data.projectNumber} | ${data.projectName}`;
  const allActivities = data.itps.flatMap((itp) => itp.activities.map((a) => ({ itp, a })));

  // ── Master register totals (the reference's "Scenario totals" paragraph, from real data) ─────
  const planned = allActivities.length;
  const count = (s: DataBookRecordState) => allActivities.filter(({ a }) => a.state === s).length;
  const accepted = count("Accepted") + count("Accepted with comments");
  const inReview = count("In review");
  const draft = count("Draft");
  const rejected = count("Rejected");
  const missing = count("Missing");
  const received = planned - missing;
  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

  const partyNames = (type: string) => data.parties.filter((p) => p.partyType === type).map((p) => escapeHtml(p.name)).join(", ");

  // ── Contents ────────────────────────────────────────────────────────────────────────────────
  const itpSectionIds = data.itps.map((_, i) => `rec-itp-${i}`);
  const registerChunks: Array<{ id: string; from: number; to: number }> = [];
  for (let i = 0; i < Math.max(allActivities.length, 1); i += 10) {
    registerChunks.push({ id: `register-${i / 10}`, from: i + 1, to: Math.min(i + 10, Math.max(allActivities.length, 1)) });
  }
  const toc: Array<[string, string]> = [
    ["cover", "Data Book"],
    ["control", "Document control and authorization"],
    ["revision", "Revision distribution and issue status"],
    ["contents", "Contents and navigation"],
    ["scope", "Scope terminology and configuration"],
    ["applicability", "Applicability and governing requirements"],
    ["schema", "Master record register and record schema"],
    ...registerChunks.map((c): [string, string] => [c.id, `Master record register entries ${String(c.from).padStart(2, "0")} to ${String(c.to).padStart(2, "0")}`]),
    ...data.itps.map((itp, i): [string, string] => [itpSectionIds[i], `Inspection and testing records — ${itp.itpNumber}`]),
    ["materials", "Materials and traceability"],
    ["welding", "Welding and joining records"],
    ["calibration", "Calibration and regulated certificates"],
    ["personnel", "Personnel certifications"],
    ["standalone", "Standalone inspections and FAT"],
    ["ncrs", "Nonconformance deviation and exceptions"],
    ["punch", "Mechanical completion and punch list"],
    ["readiness", "Readiness calculations and hard gates"],
    ["certification", "Final completeness certification"],
    ["acceptance", "Final acceptance and handover record"],
  ];

  // ── Part A ──────────────────────────────────────────────────────────────────────────────────
  const cover = `
  <section class="page cover" id="cover">
    <span class="mk">§cover§</span>
    <div class="letterhead"><div class="brand">${renderBrandBlock(data)}</div></div>
    <div class="part">${escapeHtml(data.organizationName ?? "JAGS ASSURANCE")}</div>
    <h1 class="cover-title">Project Data Book</h1>
    <p class="lead">${escapeHtml(data.title)}. Controlled package of inspection, test and completion records with an index, traceability and release evidence.</p>
    <h3>${escapeHtml(issuePurpose(data))} issue</h3>
    ${table(
      ["Document control", "Value"],
      [
        ["Document number", escapeHtml(data.bookNumber)],
        ["Revision and issue date", `Rev 0 | ${issueDate}`],
        ["Project and package", `${escapeHtml(projectLabel)} | ${data.itps.map((i) => escapeHtml(i.itpNumber)).join(", ") || "no ITP"}`],
        ["Equipment scope", data.itps.map((i) => escapeHtml(i.title)).join("; ") || "—"],
        ["Records in book", `${planned} activity records across ${data.itps.length} ITP${data.itps.length === 1 ? "" : "s"}`],
        ["Volume", "1 of 1"],
        ["Document owner", "Jags Assurance"],
      ],
      ["32%", "68%"]
    )}
    <p class="note">${
      data.status === "issued"
        ? data.overrideReason
          ? "CONDITIONAL HANDOVER. Issued with the outstanding conditions listed in Part D; this is not an unqualified final completeness certificate. Printed copies are uncontrolled."
          : "FINAL ISSUE. Contents are the frozen records listed in the master register. Printed copies are uncontrolled."
        : data.status === "compiled"
          ? "FOR REVIEW — NOT ISSUED. Compiled for review; it becomes final only when issued. Unsigned fields and incomplete records are shown as such. This is not a certificate of completeness."
          : "DRAFT — NOT FOR ISSUE. Records are listed as they stand at generation time; unsigned fields and incomplete records are shown as such. This is not a certificate of completeness."
    }</p>
    ${renderPoweredByFooter(data)}
  </section>`;

  const itpApprovalRows = data.itps.map((itp) => [
    escapeHtml(itp.itpNumber) + ` Rev ${itp.revision}`,
    cell(itp.preparedBy),
    itp.reviewedBy ? `${escapeHtml(itp.reviewedBy)}<br /><small>${fmtDate(itp.reviewedAt)}</small>` : "Not performed",
    itp.approvedBy ? `${escapeHtml(itp.approvedBy)}<br /><small>${fmtDate(itp.approvedAt)}</small>` : "Not performed",
    itp.acceptedBy ? `${escapeHtml(itp.acceptedBy)}<br /><small>${fmtDate(itp.acceptedAt)}</small>` : "Not requested",
  ]);

  const control = page(
    "control",
    "PART A  DOCUMENT CONTROL",
    "Document control and authorization",
    "The cover identifies the book. This control sheet identifies the accountable organizations and the approval route.",
    `
    ${table(
      ["Metadata field", "Value"],
      [
        ["Client and project", `${cell(data.organizationName)} | ${escapeHtml(projectLabel)}`],
        ["Site and jurisdiction", cell(data.siteLocation)],
        ["EPC or EPCM and contractor", partyNames("main_contractor") || "—"],
        ["Vendor and purchase order", [...new Set(data.materials.map((m) => m.po).filter(Boolean))].map((p) => escapeHtml(p as string)).join(", ") || "—"],
        ["Area and system", "—"],
        ["Package and asset identifiers", `${data.itps.length} ITP${data.itps.length === 1 ? "" : "s"}: ${data.itps.map((i) => escapeHtml(i.itpNumber)).join(", ") || "none"}`],
        ["Scope boundary", data.itps.map((i) => escapeHtml(i.title)).join("; ") || "—"],
        ["Language and classification", "English | Project distribution"],
        ["Requirements baseline", "Approved ITPs listed in Part C at their stated revision"],
      ],
      ["32%", "68%"]
    )}
    <h3>Prepared reviewed and approved</h3>
    ${table(
      ["Function", "Name and title", "Decision and signature", "Date"],
      [
        ["Prepared by", cell(data.compiledBy), data.compiledBy ? "Compiled in QMP Inspect" : "Unsigned", fmtDate(data.compiledAt)],
        ["QA review", cell(distinct(data.itps.map((i) => i.reviewedBy))), data.itps.some((i) => i.reviewedBy) ? "Reviewed (ITP review step)" : "Not performed", fmtDate(data.itps.map((i) => i.reviewedAt).filter(Boolean).sort().pop() ?? null)],
        ["Technical review", cell(distinct(data.itps.map((i) => i.approvedBy))), data.itps.some((i) => i.approvedBy) ? "Approved (ITPs)" : "Not performed", fmtDate(data.itps.map((i) => i.approvedAt).filter(Boolean).sort().pop() ?? null)],
        ["Contractor approval", cell(data.overrideBy), data.status === "issued" ? "Issued" : "Not performed", data.status === "issued" ? fmtDate(data.compiledAt) : "—"],
        ["Client acceptance", cell(distinct(data.itps.map((i) => i.acceptedBy))), data.itps.some((i) => i.acceptedBy) ? "Accepted (ITPs)" : data.status === "issued" ? "Per handover record" : "Not requested", fmtDate(data.itps.map((i) => i.acceptedAt).filter(Boolean).sort().pop() ?? null)],
      ],
      ["24%", "28%", "30%", "18%"]
    )}
    <h3>ITP approval chain — each ITP behind this book</h3>
    ${itpApprovalRows.length > 0 ? table(["ITP", "Prepared by", "Reviewed", "Approved", "Client accepted"], itpApprovalRows) : "<p>No ITPs on this project.</p>"}
    <p class="small">Preparation, technical approval and client acceptance are separate decisions. Each records the person, role and date; a typed name alone is not verified approval.</p>`
  );

  const revision = page(
    "revision",
    "PART A  DOCUMENT CONTROL",
    "Revision distribution and issue status",
    "Book revisions and individual record revisions are controlled independently. Issuing a new book must not rewrite the history of its source records.",
    `
    ${table(["Revision", "Date", "Description", "Authorization"], [[bookRevLabel(data), issueDate, `${escapeHtml(issuePurpose(data))} issue`, data.status === "issued" ? "Issued" : "Unsigned draft"]], ["12%", "16%", "44%", "28%"])}
    <h3>Distribution register</h3>
    ${table(
      ["Recipient role", "Purpose", "Issue reference", "Receipt"],
      data.parties.length > 0
        ? data.parties.map((p) => [
            `${escapeHtml(p.name)}<br /><small>${escapeHtml(p.partyType.replace(/_/g, " "))}</small>`,
            data.status === "issued" ? "Project handover issue" : "Review of output and records",
            data.status === "issued" ? escapeHtml(data.bookNumber) : "Not issued",
            "[Acknowledgment]",
          ])
        : [["—", "—", "Not issued", "Not applicable"]],
      ["30%", "30%", "20%", "20%"]
    )}
    <h3>Independent status dimensions</h3>
    <ul>
      <li>Issue purpose: Draft, For Review, For Acceptance, Final or As-Built. <b>This book: ${escapeHtml(issuePurpose(data))}.</b></li>
      <li>Record lifecycle: Draft, In review, Accepted, Rejected or Missing — the state column of the master register.</li>
      <li>Review decision: Pending, Accepted, Accepted with Comments, Revise and Resubmit or Rejected — recorded per ITP review step and client acceptance.</li>
      <li>Package gate: Not Ready, Ready for QA, Ready for Client, Ready for Release, Released or Superseded. <b>This book: ${data.isReady ? "Ready for release" : "Not ready — see Readiness calculations and hard gates"}.</b></li>
    </ul>
    <p>Freeze each issued version with a manifest and transmittal. Retain prior issues under the agreed retention policy. Printed copies are uncontrolled unless the project registers and controls them.</p>`
  );

  const contents = page(
    "contents",
    "PART A  DOCUMENT CONTROL",
    "Contents and navigation",
    "This index is the reading route for the book. The master record register separately controls individual deliverables.",
    `<ol class="toc">${toc
      .map(([id, label]) => `<li><a href="#${id}"><span>${escapeHtml(label)}</span><i></i><b>${pageMap[id] ?? ""}</b></a></li>`)
      .join("")}</ol>
    <p class="small">All page references use the physical page count, including the cover. They are regenerated on every export.</p>`
  );

  const scope = page(
    "scope",
    "PART A  DOCUMENT CONTROL",
    "Scope terminology and configuration",
    "One configurable evidence system. Core controls apply to every book; conditional sections appear when the project has records of that kind.",
    `${table(
      ["Term", "Meaning in this book"],
      [
        ["Data Book", "Controlled package of records with an index, traceability and release evidence."],
        ["ITP", "Inspection and Test Plan — the approved list of activities, intervention points (H/W/R/S) and acceptance criteria."],
        ["IRN", "Inspection Release Notice — issued once an inspection record is released."],
        ["Record state", "Accepted = record exists with a pass result and an issued IRN. In review = record exists, release pending. Draft = record opened with no result. Rejected = failed result. Missing = no record yet."],
        ["Core and conditional", "ITP, register and readiness sections are core. Materials, welding, calibration, NCR and punch-list sections list whatever the project has recorded."],
      ],
      ["24%", "76%"]
    )}
    <p>Unknown applicability is unresolved, not Not Applicable. A record that is missing is shown as missing — it is never hidden or counted as complete.</p>`
  );

  const categoryRows: string[][] = [
    ["Inspection and testing records (ITP activities)", String(allActivities.length), allActivities.length ? "Applicable" : "Unresolved", "Part C — Inspection and testing records"],
    ["Materials and traceability", String(data.materials.length), data.materials.length ? "Applicable" : "No records yet", "Part C — Materials and traceability"],
    ["Welding and joining (welder qualifications)", String(data.welders.length), data.welders.length ? "Applicable" : "No records yet", "Part C — Welding and joining records"],
    ["Calibration and regulated certificates", String(data.calibrations.length), data.calibrations.length ? "Applicable" : "No records yet", "Part C — Calibration"],
    ["Standalone inspections and FAT", String((data.standalone ?? []).length), (data.standalone ?? []).length ? "Applicable" : "No records yet", "Part C — Standalone inspections and FAT"],
    ["Nonconformance, deviation and exceptions", String(data.ncrs.length), data.ncrs.length ? "Applicable" : "None raised", "Part C — Nonconformance"],
    ["Mechanical completion and punch list", String(data.punchItems.length), data.punchItems.length ? "Applicable" : "None raised", "Part C — Mechanical completion"],
  ];
  const applicability = page(
    "applicability",
    "PART A  RESEARCH AND APPLICABILITY",
    "Applicability and governing requirements",
    "Treat applicability as an approved decision against a requirement instance. Hiding a section is not evidence that the requirement was evaluated.",
    `${table(["Record category", "Records", "Applicability", "Where recorded"], categoryRows, ["38%", "10%", "18%", "34%"])}
    <h3>Applicability decision record</h3>
    <p>Requirement ID [ ] | Scope [ ] | Source and edition [ ] | Applicable / Not Applicable / Unresolved [ ] | Reason [ ] | Evidence [ ] | Decided by [ ] | Approved by [ ] | Date [ ]</p>
    <p>Not Applicable removes an approved instance from the denominator and remains visible in the applicability register. A waiver, concession or deferred deliverable remains a distinct exception; it must not silently disappear from completeness reporting. Regulatory obligations cannot be waived by an ordinary project approver.</p>`
  );

  const schema = page(
    "schema",
    "PART B  EVIDENCE REGISTER",
    "Master record register and record schema",
    "The register is the control point for every expected deliverable. A folder inventory cannot reveal records that were never submitted.",
    `${table(
      ["Field group", "Required fields"],
      [
        ["Identity", "Requirement instance ID; record number; title (activity); discipline; record type; section; organization."],
        ["Traceability", "Project; package (ITP); intervention points per party; related IRN and NCR references."],
        ["Requirement", "Reference clause and standard; acceptance criteria; responsible party."],
        ["Version and review", "ITP revision; lifecycle state; reviewer decision; superseded version."],
        ["Files and issue", "Inspection record and IRN; attachments; book and volume; form page."],
        ["Completion", "Evidence satisfaction; approvals; unresolved exceptions; included-in-manifest flag."],
      ],
      ["24%", "76%"]
    )}
    <p>Each row represents one expected deliverable instance — here one ITP activity. Requirements may need multiple records, and one record may satisfy several mapped requirements; relationships are stored, not duplicated as files. The following pages list the register in groups of ten; "Form page" is the page where that activity's record layout starts.</p>`
  );

  // ── Part B — master register ────────────────────────────────────────────────────────────────
  const formPageOf = (itpIndex: number) => pageMap[itpSectionIds[itpIndex]] ?? "";
  const registerRowsAll = allActivities.map(({ itp, a }, i) => [
    `R${String(i + 1).padStart(2, "0")}`,
    a.recordNumber ? escapeHtml(a.recordNumber) : `${escapeHtml(itp.itpNumber)} / ${escapeHtml(a.itemNumber)}`,
    escapeHtml(a.activity),
    String(itp.revision),
    stateBadge(a.state),
    String(formPageOf(data.itps.indexOf(itp))),
  ]);
  const registerTotals = `<p>Totals at generation: ${planned} planned records; ${accepted} accepted; ${inReview} in review; ${draft} draft; ${rejected} rejected; ${missing} missing. Records with a file or entry received: ${received} of ${planned} (${pct(received, planned)}). Accepted completeness: ${accepted} of ${planned} (${pct(accepted, planned)}). Book readiness: <b>${data.isReady ? "READY" : "NOT READY"}</b>.</p>`;
  const registerPages = registerChunks.map((c) =>
    page(
      c.id,
      "PART B  EVIDENCE REGISTER",
      `Master record register entries ${String(c.from).padStart(2, "0")} to ${String(c.to).padStart(2, "0")}`,
      `${data.status === "issued" ? "ISSUED RECORDS" : "WORKING DATA — NOT FINAL"} | All records link to ${projectLabel}.`,
      `${registerRowsAll.length > 0 ? table(["Req", "Document", "Deliverable", "Rev", "State", "Form page"], registerRowsAll.slice(c.from - 1, c.to), ["7%", "22%", "42%", "6%", "13%", "10%"]) : "<p>No ITP activities on this project yet.</p>"}
      ${registerTotals}`
    )
  );

  // ── Part C — per-ITP inspection and test records ────────────────────────────────────────────
  const itpPages = data.itps.map((itp, i) => {
    const rows = itp.activities.map((a) => {
      const intervention = a.interventions.length
        ? a.interventions
            .map((iv) => `<div><b>${escapeHtml(iv.code)}</b> ${escapeHtml(iv.partyName)} — ${escapeHtml(iv.status.replace(/_/g, " "))}${iv.signedBy ? ` (${escapeHtml(iv.signedBy)}, ${fmtDate(iv.signedAt)})` : ""}</div>`)
            .join("")
        : "<div>No intervention points</div>";
      const criteria = a.criteria ? `<div>Criteria: ${escapeHtml(a.criteria)}</div>` : "";
      const reference = a.reference ? `<div>Ref: ${escapeHtml(a.reference)}</div>` : "";
      const evidence = a.recordNumber
        ? `<div><b>${escapeHtml(a.recordNumber)}</b> — ${escapeHtml(a.result ?? "no result")}</div><div>${fmtDate(a.inspectionDate)}${a.inspector ? ` · ${escapeHtml(a.inspector)}` : ""}</div><div>${a.irnNumber ? `IRN ${escapeHtml(a.irnNumber)}` : "IRN not issued"}</div>`
        : "<div>No inspection record</div>";
      return [`${escapeHtml(a.itemNumber)} ${escapeHtml(a.activity)}${reference}`, `${intervention}${criteria}`, `${evidence}<div>${stateBadge(a.state)}</div>`];
    });
    return page(
      itpSectionIds[i],
      "PART C  RECORDS",
      "Inspection and testing records",
      "Approved ITP activities are the source of expected evidence. Actual observations, results and releases are shown beside each activity.",
      `
      <h3>Record header</h3>
      <p class="header-line">${escapeHtml(itp.itpNumber)} Rev ${itp.revision} | ${escapeHtml(itp.title)} | Phase ${escapeHtml(itp.phase)} | Status ${escapeHtml(itp.status.replace(/_/g, " "))}${itp.standard ? ` | Standard ${escapeHtml(itp.standard)}` : ""}</p>
      ${rows.length > 0 ? table(["ITP point", "Intervention and criteria", "Evidence or result"], rows, ["33%", "37%", "30%"]) : "<p>This ITP has no activities.</p>"}
      <h3>Evidence to attach</h3>
      <p>Approved ITP, inspection requests, hold/witness releases, measurements, test equipment calibration and release notices.</p>
      <h3>Review and release check</h3>
      <p>A missed hold point requires disposition. Record notification, attendance and any authorized waiver of an intervention separately.</p>
      ${signLines(itp.preparedBy, null, itp.reviewedBy, itp.reviewedAt, itp.approvedBy ? `${itp.approvedBy} (${fmtDate(itp.approvedAt)})` : null)}`
    );
  });

  const registerPage = (
    id: string,
    title: string,
    intro: string,
    headers: string[],
    rows: string[][],
    emptyText: string,
    evidence: string,
    check: string,
    tableHtml?: string
  ) =>
    page(
      id,
      "PART C  RECORDS",
      title,
      intro,
      `${tableHtml ?? (rows.length > 0 ? table(headers, rows) : `<p>${escapeHtml(emptyText)}</p>`)}
      <h3>Evidence to attach</h3><p>${escapeHtml(evidence)}</p>
      <h3>Review and release check</h3><p>${escapeHtml(check)}</p>`
    );

  const materials = registerPage(
    "materials",
    "Materials and traceability",
    "Connect incoming material identity and certification to the installed component. Preserve traceability through cutting, assembly, substitution and repair.",
    ["Material", "Supplier / qty", "Heat / batch", "PO", "Certificate", "Approval", "Receipt / released"],
    data.materials.map((m) => [
      escapeHtml(m.description),
      `${cell(m.supplier)}${m.quantity ? ` / ${escapeHtml(m.quantity)}` : ""}`,
      `${cell(m.heat)}${m.batch ? ` / ${escapeHtml(m.batch)}` : ""}`,
      cell(m.po),
      cell(m.certificate),
      escapeHtml(m.approval),
      `${escapeHtml(m.receipt.replace(/_/g, " "))}${m.releasedAt ? `<br /><small>${fmtDmy(m.releasedAt)}</small>` : ""}`,
    ]),
    "No materials recorded in the project material register.",
    "MTC/MTR or material certificate, receiving inspection, heat/lot transfer record, PMI and substitutions.",
    "Check certificate authenticity, material identity and traceability continuity. Only materials approved (A/B) and released count as complete."
  );

  const welding = registerPage(
    "welding",
    "Welding and joining records",
    "Track procedure qualification and personnel qualification for the joints made on this project.",
    ["Welder / operator", "WPS", "Qualified range", "Expiry", "Status"],
    data.welders.map((w) => [escapeHtml(w.welder), escapeHtml(w.wps), cell(w.ranges), fmtDmy(w.expiry), escapeHtml(w.status)]),
    "No welder qualifications recorded in the project register.",
    "Approved WPS/PQR, welder/operator qualifications and continuity, weld map/log, consumable certificates, repair records and linked NDT.",
    "Confirm qualification coverage for the actual work at the work date. Possession of a WPS is not proof that each joint followed it."
  );

  const calibration = registerPage(
    "calibration",
    "Calibration and regulated certificates",
    "Calibration status of the instruments used on this project, checked against their due dates.",
    ["Instrument", "Certificate", "Calibrated", "Due", "Status"],
    data.calibrations.map((c) => [escapeHtml(c.instrument), escapeHtml(c.certNumber), fmtDmy(c.calDate), fmtDmy(c.dueDate), escapeHtml(c.status)]),
    "No calibration certificates recorded in the project register.",
    "Original calibration certificates, traceability to national standards and the instrument-to-activity mapping.",
    "Check calibration at the date of use. An expired instrument requires impact assessment and retest before the activity is satisfied."
  );

  const personnel = registerPage(
    "personnel",
    "Personnel certifications",
    "Personal certifications held by people working on this project, checked against their expiry dates.",
    ["Name", "Certification", "Certificate no.", "Expiry", "Status"],
    (data.personnel ?? []).map((p) => [escapeHtml(p.name), escapeHtml(p.certification), cell(p.certNumber), fmtDmy(p.expiry), escapeHtml(p.status)]),
    "No personnel certifications recorded in the project register.",
    "Copies of personal certificates (for example NDT, welding, electrical) and employer verification of scope.",
    "Confirm each certificate was valid on the date the person performed the work."
  );

  const standalone = registerPage(
    "standalone",
    "Standalone inspections and FAT",
    "Factory acceptance tests, pre-shipment and other standalone inspections for this project, with their conclusion and clearance.",
    ["Assignment", "Type", "Equipment / serial", "Date", "Conclusion", "Clearance"],
    (data.standalone ?? []).map((s) => [escapeHtml(s.number), escapeHtml(s.type), escapeHtml(s.equipment), fmtDmy(s.date), escapeHtml(s.conclusion), escapeHtml(s.clearance)]),
    "No standalone inspections or FAT assignments on this project.",
    "Signed FAT / inspection report, measurements, photos and any clearance record.",
    "A conditional pass counts as complete only once clearance has been issued."
  );

  const ncrDetailLine = (n: DataBookPdfNcr): string => {
    const part = (label: string, v: string | null | undefined) => `<strong>${label}:</strong> ${v && v.trim() ? escapeHtml(v) : "&mdash;"}`;
    return [
      part("Root cause", n.rootCause),
      part("Corrective", n.correctiveAction),
      part("Preventive", n.preventiveAction),
      part("Verification", n.verificationNotes),
      part("Closed by", n.closedByName),
      `<strong>Evidence:</strong> ${n.evidenceCount ?? 0} file${(n.evidenceCount ?? 0) === 1 ? "" : "s"}`,
    ].join(" &middot; ");
  };
  const ncrHeaders = ["NCR", "Description", "Severity", "Status", "Closed"];
  const ncrTableHtml = `<table class="grid"><thead><tr>${ncrHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${data.ncrs
    .map(
      (n) =>
        `<tr style="page-break-inside:avoid"><td>${escapeHtml(n.number)}</td><td>${escapeHtml(n.description)}</td><td>${escapeHtml(severityLabel(n.severity))}</td><td>${escapeHtml(n.status.replace(/_/g, " "))}</td><td>${fmtDate(n.closedAt)}</td></tr><tr style="page-break-inside:avoid"><td colspan="5" style="font-size:0.9em">${ncrDetailLine(n)}</td></tr>`
    )
    .join("")}</tbody></table>`;
  const ncrs = registerPage(
    "ncrs",
    "Nonconformance deviation and exceptions",
    "Every nonconformance raised on the project with its disposition. A book cannot be final while an NCR remains open.",
    ncrHeaders,
    [],
    "No nonconformances raised on this project.",
    "NCR forms with root cause, corrective action, verification notes and closure evidence.",
    "A blocking NCR prevents release regardless of the completion percentage.",
    data.ncrs.length > 0 ? ncrTableHtml : undefined
  );


  const punch = registerPage(
    "punch",
    "Mechanical completion and punch list",
    "Open punch-list items are completion exceptions; they must be verified closed or carried as listed conditions.",
    ["Pri.", "Item", "Source", "Location", "Responsible", "Status", "Due", "Closed", "Closing evidence", "Verification (verifier)"],
    data.punchItems.map((p) => [
      cell(p.priority),
      escapeHtml(p.description),
      escapeHtml((p.source ?? "").replace(/_/g, " ")),
      cell(p.location),
      cell(p.responsibleParty),
      escapeHtml(p.status),
      fmtDate(p.dueDate),
      fmtDate(p.closedAt),
      cell(p.closingEvidence),
      p.verificationNotes || p.verifiedBy ? `${escapeHtml(p.verificationNotes ?? "")}${p.verifiedBy ? ` <i>(${escapeHtml(p.verifiedBy)})</i>` : ""}` : cell(null),
    ]),
    "No punch-list items on this project.",
    "Resolver's closing evidence and the verifier's closure record for every item.",
    `${data.openPunchItems} open item${data.openPunchItems === 1 ? "" : "s"} at generation; ${data.punchItems.filter((p) => p.status !== "closed").length} not yet verified closed.`
  );

  // ── Part D — release controls ───────────────────────────────────────────────────────────────
  const readiness = page(
    "readiness",
    "PART D  RELEASE CONTROLS",
    "Readiness calculations and hard gates",
    "Completeness and readiness are shown together. A high percentage never hides an open exception.",
    `
    <p><b>Overall completion ${data.overallPercentage}%</b> | Open punch-list items ${data.openPunchItems} | Book readiness <b>${data.isReady ? "READY FOR HANDOVER" : "NOT READY"}</b></p>
    ${table(
      ["Category", "Provided / Required", "Complete"],
      data.categories.map((c) => [escapeHtml(c.label), `${c.ready} / ${c.total}`, `<b class="${c.percentage === 100 ? "okc" : c.percentage === 0 ? "badc" : "warnc"}">${c.percentage}%</b>`]),
      ["60%", "22%", "18%"]
    )}
    <h3>Breakdown by service / discipline</h3>
    ${
      data.disciplineBreakdown.length > 0
        ? table(
            ["Discipline", "ITPs", "NCRs", "First-time pass rate"],
            data.disciplineBreakdown.map((r) => [
              `${escapeHtml(r.disciplineName)} <small>${escapeHtml(r.disciplineCode)}</small>`,
              String(r.itpCount),
              String(r.ncrCount),
              r.firstTimePassRate === null ? "&mdash;" : `${r.firstTimePassRate}% <small>(${r.firstTimePasses}/${r.firstAttempts})</small>`,
            ])
          )
        : "<p>No ITP activities on this project are tagged with a discipline yet.</p>"
    }
    ${data.overrideReason ? `<h3>Conditional handover</h3><p>${escapeHtml(data.overrideReason)}</p>` : ""}
    <p class="small">Applicable count = expected records. Accepted completeness = accepted ÷ applicable. A missing record is never removed from the denominator.</p>`
  );

  const openNcrCount = data.ncrs.filter((n) => n.status !== "closed" && n.severity !== "observation").length;
  const certRows: string[][] = [
    ["Book", `${escapeHtml(data.bookNumber)} | ${escapeHtml(projectLabel)}`],
    ["Applicable records", `${planned}`],
    ["Accepted records", `${accepted} of ${planned} | ${pct(accepted, planned)}`],
    ["Unresolved deliverables", `${inReview} in review; ${rejected} rejected; ${missing} missing; ${draft} draft`],
    ["Open exceptions", `${data.punchItems.filter((p) => p.status !== "closed").length} punch item${data.punchItems.filter((p) => p.status !== "closed").length === 1 ? "" : "s"} not verified closed; ${openNcrCount} open NCR${openNcrCount === 1 ? "" : "s"}`],
    ["Final issue decision", data.isReady && data.status === "issued" ? "READY | Issued" : data.isReady ? "READY | Awaiting issue" : "NOT READY | Certificate unsigned"],
  ];
  const certification = page(
    "certification",
    "PART D  RELEASE CONTROLS",
    "Final completeness certification",
    "This certification is a form generated after rule checks and attested only by authorized reviewers against the same frozen issue.",
    `
    ${table(["Certification field", "Outcome"], certRows, ["32%", "68%"])}
    <h3>Certification wording for a complete issue</h3>
    <p>We confirm that the records listed in the identified issue manifest have been checked against the approved requirements baseline; applicable requirements are satisfied by the accepted current evidence; required approvals are recorded; and no unresolved item prohibits this release. This statement applies only to the named scope and frozen issue.</p>
    <p>If outstanding items are permitted by the contract, issue a separately titled Conditional Handover Record listing every condition.</p>
    ${table(
      ["Attestation", "Name and authority", "Signature and date"],
      [
        ["Compiled by", cell(data.compiledBy), data.compiledBy ? `${fmtDate(data.compiledAt)}` : "Unsigned"],
        ["QA verified by", "&nbsp;", "Unsigned"],
        ["Release approved by", cell(data.overrideBy), data.status === "issued" ? "Issued" : "Unsigned"],
        ["Client accepted (if required)", "&nbsp;", "Unsigned"],
      ],
      ["30%", "40%", "30%"]
    )}
    <p class="small">The software supplies calculations and evidence links. Only an authorized person can make an attestation.</p>`
  );

  const acceptance = page(
    "acceptance",
    "PART D  RELEASE CONTROLS",
    "Final acceptance and handover record",
    "Record the receiving party's decision for a defined scope and issue. Acceptance conditions and contract consequences must be explicit.",
    `
    <h3>Record header</h3>
    <p class="header-line">Book ${escapeHtml(data.bookNumber)} | ${escapeHtml(projectLabel)} | ${escapeHtml(issuePurpose(data))} issue ${bookRevLabel(data)}</p>
    ${table(
      ["Acceptance field", "Entry"],
      [
        ["Scope", `${data.itps.length} ITP${data.itps.length === 1 ? "" : "s"}, ${planned} records, issue ${bookRevLabel(data)}`],
        ["Decision", data.status === "issued" ? (data.overrideReason ? "Issued as a Conditional handover — client acceptance of the conditions pending" : "Issued — see signed acceptance") : "Not requested — book not issued"],
        ["Conditions", data.overrideReason ? escapeHtml(data.overrideReason) : "None recorded"],
        ["Custody and effective date", "&nbsp;"],
        ["Handover certificate", data.handoverCertificate.ready > 0 ? "Issued" : "Not issued"],
        ["Signatures", "Contractor authorized approval and client/operator acceptance evidence — unsigned in a draft"],
      ],
      ["30%", "70%"]
    )}
    <p>${data.isReady ? "All gating categories complete." : "Decision: NOT READY — no acceptance signature is valid or supplied."} Conditional acceptance is not final complete status.</p>`
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.bookNumber)}</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }

  :root {
    --navy: ${safeHex(data.branding?.brandPrimaryColor) ?? "#173b53"};
    --accent: ${safeHex(data.branding?.brandAccentColor) ?? "#173b53"};
    --band: #f1f5f8;
    --rule: #cfd8de;
    --ink: #1c1c1e;
    --success: #1f7a4d;
    --warn: #a86b00;
    --danger: #b3261e;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: Calibri, "Segoe UI", Arial, Helvetica, sans-serif;
    color: var(--ink);
    background: #fff;
    font-size: 10.5px;
    line-height: 1.45;
  }

  ${data.status === "issued" ? "" : `body::before {
    content: "${data.status === "compiled" ? "FOR REVIEW" : "DRAFT"}";
    position: fixed; top: 42%; left: 0; right: 0; text-align: center;
    font-size: 110px; font-weight: bold; letter-spacing: 8px;
    color: rgba(23, 59, 83, 0.06); transform: rotate(-30deg); z-index: 0; pointer-events: none;
  }`}

  .page { break-before: page; position: relative; z-index: 1; }
  .page:first-of-type { break-before: auto; }

  .part { color: var(--navy); font-size: 8.5px; font-weight: bold; letter-spacing: 0.4px; text-transform: uppercase; margin-bottom: 4px; }
  h1 { font-size: 24px; margin: 6px 0 10px 0; line-height: 1.15; }
  h3 { font-size: 12px; margin: 16px 0 6px 0; }
  .lead { font-size: 11px; margin: 0 0 12px 0; }
  .small { font-size: 9px; color: #444; }
  small { font-size: 8px; color: #666; }
  .note { margin-top: 14px; font-weight: bold; }
  .header-line { font-weight: bold; }
  ul, ol { margin: 6px 0 10px 18px; padding: 0; }
  li { margin-bottom: 3px; }

  .cover-title { font-size: 34px; margin-top: 14px; }
  .letterhead { display: flex; align-items: center; margin-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand-mark {
    width: 30px; height: 30px; border-radius: 50%; background: var(--navy); color: #fff;
    font-weight: bold; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .wordmark { font-size: 15px; font-weight: bold; color: var(--navy); letter-spacing: 0.5px; }
  .wordmark small { display: block; font-size: 8px; font-weight: normal; letter-spacing: 1.5px; text-transform: uppercase; color: #666; }
  .org-logo { max-height: 34px; max-width: 160px; object-fit: contain; }
  .org-logo-co-branded { padding-left: 10px; border-left: 1px solid var(--rule); }
  .powered-by { margin-top: 10px; font-size: 7px; color: #999; text-align: right; }

  table.grid { width: 100%; border-collapse: collapse; font-size: 9.5px; margin: 6px 0 10px 0; }
  table.grid th {
    background: var(--navy); color: #fff; text-align: left; font-weight: bold; padding: 6px 8px;
    border: 1px solid var(--navy); border-bottom: 3px solid var(--accent);
  }
  table.grid td { border: 1px solid var(--rule); padding: 5px 8px; vertical-align: top; }
  table.grid tbody tr:nth-child(even) { background: var(--band); }
  table.grid tr { break-inside: avoid; }
  table.grid thead { display: table-header-group; }
  table.grid td div + div { margin-top: 1px; }

  .state { font-weight: bold; white-space: nowrap; }
  .state.ok, .okc { color: var(--success); }
  .state.warn, .warnc { color: var(--warn); }
  .state.bad, .badc { color: var(--danger); }

  .sign { margin-top: 12px; line-height: 1.8; break-inside: avoid; page-break-inside: avoid; }
  h3 { break-after: avoid; page-break-after: avoid; }
  section.cover table.grid, #control table.grid, #certification table.grid { break-inside: avoid; page-break-inside: avoid; }

  ol.toc { list-style: none; margin: 8px 0; }
  ol.toc li { padding: 6px 0; border-bottom: 1px dotted var(--rule); }
  ol.toc a { color: var(--navy); text-decoration: none; display: flex; align-items: baseline; gap: 6px; }
  ol.toc a i { flex: 1; border-bottom: 1px dotted #9aa8b2; transform: translateY(-3px); }
  ol.toc a b { font-weight: normal; min-width: 18px; text-align: right; }
  .mk { position: absolute; font-family: "Courier New", monospace; font-variant-ligatures: none; font-size: 1px; line-height: 1px; color: #fff; }
</style>
</head>
<body>
  ${cover}
  ${control}
  ${revision}
  ${contents}
  ${scope}
  ${applicability}
  ${schema}
  ${registerPages.join("")}
  ${itpPages.join("")}
  ${materials}
  ${welding}
  ${calibration}
  ${personnel}
  ${standalone}
  ${ncrs}
  ${punch}
  ${readiness}
  ${certification}
  ${acceptance}
  <p class="small" style="text-align:right;margin-top:10px">Generated ${escapeHtml(generatedAtLabel)} &middot; Uncontrolled when printed</p>
</body>
</html>`;
}

/** Only a plain #rrggbb value is ever interpolated into the stylesheet. */
function safeHex(value: string | null | undefined): string | null {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}
