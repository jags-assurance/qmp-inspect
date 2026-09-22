// Renders the printable HTML for a single NCR (Non-Conformance Report) — the branded A4 dossier
// page a client receives for one finding and its human close-out, matching the client's sample
// dossier format ("4 / NCR and human close-out"). Puppeteer renders this to portrait A4 PDF in
// renderNcrPdf.ts; this module only builds the markup. Mirrors inspectionReportTemplate.ts's
// letterhead/doc-control/table conventions exactly, just for NCR data instead of inspection-record
// data.

export type NcrPdfSeverity = "observation" | "minor_ncr" | "major_ncr";
export type NcrPdfStatus = "open" | "in_progress" | "pending_verification" | "closed";

export interface NcrPdfData {
  ncrNumber: string;
  severity: NcrPdfSeverity;
  projectName: string;
  organizationName: string | null;
  status: NcrPdfStatus;

  // Finding
  description: string;
  requirementNotMet: string | null;
  /** Comma-joined photo captions/filenames, or null when there is no evidence to list. */
  evidence: string | null;
  assigneeName: string | null;
  dueDate: string | null;

  // Close-out
  rootCause: string | null;
  correctiveAction: string | null;
  preventiveAction: string | null;
  verificationNotes: string | null;
  closedByName: string | null;
  closedAt: string | null;

  generatedAt: Date;
  /**
   * Drives the letterhead/footer per the organisation's engagement_mode (Reqs R113-R118) — see
   * orgBranding.ts. Optional/undefined renders exactly as jags_led (today's unchanged branding).
   */
  branding?: NcrPdfBranding;
}

export interface NcrPdfBranding {
  engagementMode: "jags_led" | "co_branded" | "white_label";
  logoUrl: string | null;
}

const SEVERITY_LABEL: Record<NcrPdfSeverity, string> = {
  observation: "Observation",
  minor_ncr: "Minor",
  major_ncr: "Major",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cell(value: string | null | undefined): string {
  return value ? escapeHtml(value) : "&mdash;";
}

/** A simple Field | Value table — used for both the Finding and Close-out sections, matching the
 *  client sample's "Field | Reviewed record" table shape (a label/value table, not two parallel
 *  record versions). */
function renderFieldValueTable(title: string, rows: [string, string | null][]): string {
  const rowsHtml = rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${cell(value)}</td></tr>`)
    .join("");

  return `
    <div class="section">
      <h2>${escapeHtml(title)}</h2>
      <table class="field-value-table">
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
}

function buildOwnerDue(assigneeName: string | null, dueDate: string | null): string | null {
  if (!assigneeName && !dueDate) return null;
  return [assigneeName, dueDate].filter(Boolean).join(" / ");
}

function buildHoldRelease(closedByName: string | null, closedAt: string | null): string {
  if (closedByName && closedAt) return `${closedByName} at ${closedAt}`;
  return "Pending";
}

function buildInitialHoldState(status: NcrPdfStatus): string {
  return status === "open" ? "NOT_RELEASED" : status.toUpperCase();
}

const JAGS_BRAND_BLOCK = '<div class="brand-mark">JA</div><div class="wordmark">JAGS ASSURANCE<small>QMP INSPECT</small></div>';

/** See itpTemplate.ts's renderBrandBlock — identical semantics, duplicated rather than shared since
 *  the two templates don't share a lib (same convention as elsewhere in this file). */
function renderBrandBlock(data: NcrPdfData): string {
  const mode = data.branding?.engagementMode ?? "jags_led";
  const logoUrl = data.branding?.logoUrl ?? null;
  if (!logoUrl) return JAGS_BRAND_BLOCK;

  const orgLogo = `<img class="org-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  if (mode === "white_label") return orgLogo;
  if (mode === "co_branded") return `${JAGS_BRAND_BLOCK}<img class="org-logo org-logo-co-branded" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  return JAGS_BRAND_BLOCK;
}

/** The literal R113 requirement — small print in white_label mode only. */
function renderPoweredByFooter(data: NcrPdfData): string {
  if ((data.branding?.engagementMode ?? "jags_led") !== "white_label") return "";
  return '<div class="powered-by">Powered by JAGS Assurance</div>';
}

export function buildNcrPdfHtml(data: NcrPdfData): string {
  const severityLabel = SEVERITY_LABEL[data.severity];
  const generatedAtLabel = data.generatedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const projectSubline = [data.organizationName, data.projectName].filter(Boolean).join(" · ");

  const findingRows: [string, string | null][] = [
    ["Finding", data.description],
    ["Requirement", data.requirementNotMet],
    ["Evidence", data.evidence],
    ["Owner / due", buildOwnerDue(data.assigneeName, data.dueDate)],
    ["Initial hold state", buildInitialHoldState(data.status)],
  ];

  const closeOutRows: [string, string | null][] = [
    ["Root cause", data.rootCause],
    ["Correction", data.correctiveAction],
    ["Corrective/preventive", data.preventiveAction],
    ["Verification", data.verificationNotes],
    ["Hold release", buildHoldRelease(data.closedByName, data.closedAt)],
    ["Status", data.status.toUpperCase()],
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.ncrNumber)}</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }

  :root {
    --burgundy: #6B1E2C;
    --gold: #F5C518;
    --off-white: #F9F7F4;
    --ink: #1C1C1E;
    --success: #1f7a4d;
    --danger: #b3261e;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: Arial, Helvetica, sans-serif;
    color: var(--ink);
    background: #fff;
    font-size: 10px;
  }

  .letterhead {
    display: flex;
    justify-content: space-between;
    align-items: stretch;
    gap: 14px;
    background: var(--burgundy);
    border-bottom: 4px solid var(--gold);
    border-radius: 4px;
    padding: 10px 16px;
    margin-bottom: 10px;
  }

  .brand { display: flex; align-items: center; gap: 10px; }

  .brand-mark {
    width: 30px; height: 30px; border-radius: 50%;
    background: var(--gold); color: var(--burgundy);
    font-weight: bold; font-size: 14px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }

  .wordmark { font-size: 16px; font-weight: bold; color: #fff; letter-spacing: 0.5px; }
  .wordmark small {
    display: block; font-size: 8px; font-weight: normal;
    color: var(--gold); letter-spacing: 1.5px; text-transform: uppercase;
  }

  /* Client org logo (Reqs R113-R118) — see renderBrandBlock. */
  .org-logo { max-height: 34px; max-width: 160px; object-fit: contain; }
  .org-logo-co-branded { padding-left: 10px; border-left: 1px solid rgba(255, 255, 255, 0.3); }
  .powered-by { margin-top: 4px; font-size: 7px; color: #999; text-align: right; }

  .doc-control {
    background: var(--off-white); border: 1px solid var(--gold); border-radius: 3px; min-width: 190px;
  }
  .doc-control-title {
    background: var(--gold); color: var(--ink); font-size: 7.5px; font-weight: bold;
    letter-spacing: 0.5px; text-transform: uppercase; padding: 2px 8px;
  }
  .doc-control-body {
    display: grid; grid-template-columns: auto 1fr; gap: 1px 8px;
    padding: 4px 8px 5px 8px; font-size: 9px; color: var(--ink);
  }
  .doc-control-body dt { color: #666; font-size: 7.5px; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; }
  .doc-control-body dd { margin: 0; font-weight: bold; font-family: "Courier New", monospace; }

  h1 { margin: 4px 0 2px 0; font-size: 18px; color: var(--ink); }
  .subline { margin: 0 0 10px 0; font-size: 10px; color: #666; }

  .section { margin-bottom: 14px; }
  .section h2 {
    font-size: 12px; color: var(--burgundy); border-bottom: 1px solid var(--burgundy);
    padding-bottom: 3px; margin: 0 0 6px 0;
  }

  table.field-value-table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  table.field-value-table th, table.field-value-table td {
    border: 1px solid #ccc; padding: 5px 8px; text-align: left; vertical-align: top;
  }
  table.field-value-table th {
    width: 32%; background: var(--off-white); font-weight: bold; color: var(--ink);
  }

  .footer-note {
    margin-top: 16px; padding-top: 6px; border-top: 1px solid #ccc;
    font-size: 7.5px; color: #666; display: flex; justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="letterhead">
    <div class="brand">
      ${renderBrandBlock(data)}
    </div>
    <div class="doc-control">
      <div class="doc-control-title">DOCUMENT CONTROL</div>
      <dl class="doc-control-body">
        <dt>DOC NO.</dt><dd>${escapeHtml(data.ncrNumber)}</dd>
        <dt>REV</dt><dd>0</dd>
        <dt>GENERATED</dt><dd>${escapeHtml(generatedAtLabel)}</dd>
      </dl>
    </div>
  </div>

  <h1>${escapeHtml(data.ncrNumber)} | ${escapeHtml(severityLabel)} NCR</h1>
  <p class="subline">${cell(projectSubline || null)}</p>

  ${renderFieldValueTable("Finding", findingRows)}

  ${renderFieldValueTable("Close-out", closeOutRows)}

  <div class="footer-note">
    <span>Doc No. ${escapeHtml(data.ncrNumber)} &middot; Uncontrolled when printed &middot; jagsassurance.com</span>
    <span>Generated ${escapeHtml(generatedAtLabel)}</span>
  </div>
  ${renderPoweredByFooter(data)}
</body>
</html>`;
}
