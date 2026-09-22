// Renders the printable HTML for a single NCR close-out CERTIFICATE (R83) — the branded A4 document
// that attests an NCR has actually been closed: root cause, corrective action, responsible party
// (when set) and who closed it, when. Puppeteer renders this to portrait A4 PDF in
// renderNcrCloseoutPdf.ts; this module only builds the markup. Mirrors irnTemplate.ts's
// letterhead/doc-control/release-banner/signoff conventions exactly (a certificate, not a dossier —
// renderNcrPdf.ts/ncrTemplate.ts already covers the finding+close-out dossier at any status; this is
// the document that only exists once the NCR is genuinely closed).

export type NcrCloseoutSeverity = "observation" | "minor_ncr" | "major_ncr";

export interface NcrCloseoutPdfData {
  ncrNumber: string;
  severity: NcrCloseoutSeverity;
  projectName: string;
  organizationName: string | null;

  description: string;

  rootCause: string;
  correctiveAction: string;
  preventiveAction: string | null;
  verificationNotes: string;
  responsiblePartyName: string | null;

  closedByName: string | null;
  closedAt: string;

  generatedAt: Date;
  /**
   * Drives the letterhead/footer per the organisation's engagement_mode (Reqs R113-R118) — see
   * orgBranding.ts. Optional/undefined renders exactly as jags_led (today's unchanged branding).
   */
  branding?: NcrCloseoutPdfBranding;
}

export interface NcrCloseoutPdfBranding {
  engagementMode: "jags_led" | "co_branded" | "white_label";
  logoUrl: string | null;
}

const SEVERITY_LABEL: Record<NcrCloseoutSeverity, string> = {
  observation: "Observation",
  minor_ncr: "Minor NCR",
  major_ncr: "Major NCR",
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

/** Same Field | Value table shape as ncrTemplate.ts's / irnTemplate.ts's renderFieldValueTable. */
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

const JAGS_BRAND_BLOCK = '<div class="brand-mark">JA</div><div class="wordmark">JAGS ASSURANCE<small>QMP INSPECT</small></div>';

/** See ncrTemplate.ts's renderBrandBlock — identical semantics, duplicated rather than shared since
 *  the templates don't share a lib (same convention as elsewhere in this file). */
function renderBrandBlock(data: NcrCloseoutPdfData): string {
  const mode = data.branding?.engagementMode ?? "jags_led";
  const logoUrl = data.branding?.logoUrl ?? null;
  if (!logoUrl) return JAGS_BRAND_BLOCK;

  const orgLogo = `<img class="org-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  if (mode === "white_label") return orgLogo;
  if (mode === "co_branded") return `${JAGS_BRAND_BLOCK}<img class="org-logo org-logo-co-branded" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  return JAGS_BRAND_BLOCK;
}

/** The literal R113 requirement — small print in white_label mode only. */
function renderPoweredByFooter(data: NcrCloseoutPdfData): string {
  if ((data.branding?.engagementMode ?? "jags_led") !== "white_label") return "";
  return '<div class="powered-by">Powered by JAGS Assurance</div>';
}

export function buildNcrCloseoutPdfHtml(data: NcrCloseoutPdfData): string {
  const severityLabel = SEVERITY_LABEL[data.severity];
  const generatedAtLabel = data.generatedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const projectSubline = [data.organizationName, data.projectName].filter(Boolean).join(" · ");

  const findingRows: [string, string | null][] = [
    ["Finding", data.description],
    ["Severity", severityLabel],
    ["Responsible party", data.responsiblePartyName],
  ];

  const closeOutRows: [string, string | null][] = [
    ["Root cause", data.rootCause],
    ["Corrective action", data.correctiveAction],
    ["Preventive action", data.preventiveAction],
    ["Verification", data.verificationNotes],
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.ncrNumber)} Close-out Certificate</title>
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

  .release-banner {
    display: flex; flex-direction: column; gap: 3px; margin-bottom: 12px;
    border: 1px solid var(--gold); border-left: 5px solid var(--success);
    background: var(--off-white); border-radius: 3px; padding: 8px 12px; font-size: 11px;
  }
  .release-banner strong { font-size: 13px; letter-spacing: 0.2px; color: var(--success); }

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

  .signoff-grid { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; break-inside: avoid; }
  .signoff-card {
    flex: 1 1 0; min-width: 180px; border: 1px solid #ccc; border-top: 3px solid var(--burgundy);
    border-radius: 2px; padding: 6px 8px 8px 8px; background: #fff;
  }
  .signoff-card-label { font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px; color: var(--burgundy); margin-bottom: 10px; }
  .signoff-card-name { font-size: 10px; font-weight: bold; min-height: 12px; }
  .signoff-card-line { border-bottom: 1px solid #999; margin: 14px 0 4px 0; }
  .signoff-card-date { font-size: 8px; color: #444; }
  .signoff-card-date span.label { color: #888; text-transform: uppercase; font-size: 7px; margin-right: 4px; }

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

  <h1>${escapeHtml(data.ncrNumber)} | NCR Close-out Certificate</h1>
  <p class="subline">${cell(projectSubline || null)}</p>

  <div class="release-banner">
    <strong>CLOSED — ${escapeHtml(severityLabel)}</strong>
    <span>This certificate confirms the non-conformance below has been closed out, with root cause, corrective action and verification recorded.</span>
  </div>

  ${renderFieldValueTable("Finding", findingRows)}

  ${renderFieldValueTable("Close-out", closeOutRows)}

  <div class="section">
    <h2>Signed off by</h2>
    <div class="signoff-grid">
      <div class="signoff-card">
        <div class="signoff-card-label">CLOSED BY</div>
        <div class="signoff-card-name">${cell(data.closedByName)}</div>
        <div class="signoff-card-line"></div>
        <div class="signoff-card-date"><span class="label">DATE</span>${cell(data.closedAt)}</div>
      </div>
    </div>
  </div>

  <div class="footer-note">
    <span>Doc No. ${escapeHtml(data.ncrNumber)} &middot; Uncontrolled when printed &middot; jagsassurance.com</span>
    <span>Generated ${escapeHtml(generatedAtLabel)}</span>
  </div>
  ${renderPoweredByFooter(data)}
</body>
</html>`;
}
