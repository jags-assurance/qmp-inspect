import { brandColorStyle } from "./orgBranding";
// Renders the printable HTML for a FAT / Standalone Assignment Report (R14) — the client
// deliverable for a Factory Acceptance Test, witness inspection, specific test or pre-shipment
// check run without a full ITP. Puppeteer renders this to portrait A4 PDF in
// renderFatReportPdf.ts; this module only builds the markup.

export interface FatReportMeasurement {
  description: string;
  nominalValue: string | null;
  tolerance: string | null;
  actualValue: string | null;
  unit: string | null;
  result: "pass" | "fail" | null;
}

export interface FatReportPhoto {
  caption: string | null;
  dataUri: string;
}

export interface FatReportPunchItem {
  description: string;
  status: "open" | "closed";
}

export interface FatReportSignature {
  role: string;
  signatoryName: string;
  /** Already a data: URL PNG — captured straight off a canvas at signing time, no fetch needed. */
  signatureDataUri: string;
  signedAt: string;
}

export interface FatReportData {
  /** Organisation brand colours (co-branded / white-label only) — see orgBranding.ts. */
  branding?: { brandPrimaryColor?: string | null; brandAccentColor?: string | null };
  assignmentNumber: string;
  assignmentType: string;
  equipmentDescription: string;
  manufacturer: string | null;
  model: string | null;
  serialTag: string | null;
  location: string | null;
  standardReference: string | null;
  assignmentDate: string | null;
  conclusion: "pass" | "conditional_pass" | "fail" | null;
  notes: string | null;
  /** Human-approved AI-drafted (or hand-written) conclusion text, saved via saveFatNarrativeAction. */
  narrative: string | null;
  organizationName: string;
  projectName: string;
  measurements: FatReportMeasurement[];
  photos: FatReportPhoto[];
  punchItems: FatReportPunchItem[];
  signatures: FatReportSignature[];
  generatedAt: Date;
}

const CONCLUSION_LABEL: Record<"pass" | "conditional_pass" | "fail", string> = {
  pass: "PASS",
  conditional_pass: "CONDITIONAL PASS — subject to punch-list close-out",
  fail: "FAIL",
};

const ASSIGNMENT_TYPE_LABEL: Record<string, string> = {
  fat: "Factory Acceptance Test",
  witness_inspection: "Witness Inspection",
  specific_test: "Specific Test",
  pre_shipment: "Pre-Shipment Inspection",
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

function renderMeasurements(rows: FatReportMeasurement[]): string {
  if (rows.length === 0) return "";
  const body = rows
    .map(
      (m) => `
        <tr>
          <td>${cell(m.description)}</td>
          <td>${cell(m.nominalValue)}</td>
          <td>${cell(m.tolerance)}</td>
          <td>${cell(m.actualValue)}</td>
          <td>${cell(m.unit)}</td>
          <td class="result-cell result-${m.result ?? "none"}">${m.result ? m.result.toUpperCase() : "&mdash;"}</td>
        </tr>`
    )
    .join("");
  return `
    <div class="section">
      <h2>Measurements / Test Data</h2>
      <table class="items-table">
        <thead><tr><th>PARAMETER</th><th>NOMINAL</th><th>TOLERANCE</th><th>ACTUAL</th><th>UNIT</th><th>RESULT</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function renderPunchList(rows: FatReportPunchItem[]): string {
  if (rows.length === 0) return "";
  const body = rows
    .map(
      (p) => `
        <tr>
          <td>${cell(p.description)}</td>
          <td class="result-cell result-${p.status === "closed" ? "pass" : "fail"}">${p.status.toUpperCase()}</td>
        </tr>`
    )
    .join("");
  return `
    <div class="section">
      <h2>Punch List</h2>
      <table class="items-table">
        <thead><tr><th>ITEM</th><th>STATUS</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function renderPhotos(photos: FatReportPhoto[]): string {
  if (photos.length === 0) return "";
  const tiles = photos
    .map(
      (p, i) => `
        <figure class="photo-tile">
          <img src="${p.dataUri}" alt="Evidence photo ${i + 1}" />
          ${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ""}
        </figure>`
    )
    .join("");
  return `<div class="section"><h2>Photos</h2><div class="photo-grid">${tiles}</div></div>`;
}

function renderSignatures(signatures: FatReportSignature[]): string {
  if (signatures.length === 0) {
    return `<p class="conclusion">No witness signatures recorded.</p>`;
  }
  const cards = signatures
    .map(
      (s) => `
        <div class="signoff-card">
          <div class="signoff-card-label">${escapeHtml(s.role)}</div>
          <img class="signature-img" src="${s.signatureDataUri}" alt="${escapeHtml(s.signatoryName)} signature" />
          <div class="signoff-card-line"></div>
          <div class="signoff-card-name">${escapeHtml(s.signatoryName)}</div>
          <div class="signoff-card-date"><span class="label">DATE</span>${escapeHtml(new Date(s.signedAt).toLocaleDateString())}</div>
        </div>`
    )
    .join("");
  return `<div class="signoff-grid">${cards}</div>`;
}

export function buildFatReportHtml(data: FatReportData): string {
  const typeLabel = ASSIGNMENT_TYPE_LABEL[data.assignmentType] ?? data.assignmentType;
  const conclusionLabel = data.conclusion ? CONCLUSION_LABEL[data.conclusion] : "IN PROGRESS";
  const generatedAtLabel = data.generatedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.assignmentNumber)}</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }

  :root {
    --burgundy: #6B1E2C; --gold: #F5C518; --off-white: #F9F7F4; --ink: #1C1C1E;
    --success: #1f7a4d; --danger: #b3261e; --warning: #b8860b;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: var(--ink); background: #fff; font-size: 10px; }

  .letterhead {
    display: flex; justify-content: space-between; align-items: stretch; gap: 14px;
    background: var(--burgundy); border-bottom: 2px solid var(--gold); border-radius: 4px;
    /* Deliberately NOT bled to the true page edge via a negative margin cancelling @page's margin —
       Chrome's print-to-PDF does not reliably apply that margin the same way twice in a row (visible
       as the logo/wordmark getting clipped), so this sits as a normal box inside the margin, the
       same reliable box model every other section on this page already uses. */
    padding: 10px 16px; margin-bottom: 10px;
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand-mark {
    width: 30px; height: 30px; border-radius: 50%; background: var(--gold); color: var(--burgundy);
    font-weight: bold; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .wordmark { font-size: 16px; font-weight: bold; color: #fff; letter-spacing: 0.5px; }
  .wordmark small { display: block; font-size: 8px; font-weight: normal; color: var(--gold); letter-spacing: 1.5px; text-transform: uppercase; }

  .doc-control { background: var(--off-white); border: 1px solid var(--gold); border-radius: 3px; min-width: 190px; }
  .doc-control-title { background: var(--gold); color: var(--ink); font-size: 7.5px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; padding: 2px 8px; }
  .doc-control-body { display: grid; grid-template-columns: auto 1fr; gap: 1px 8px; padding: 4px 8px 5px 8px; font-size: 9px; color: var(--ink); }
  .doc-control-body dt { color: #666; font-size: 7.5px; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; }
  .doc-control-body dd { margin: 0; font-weight: bold; font-family: "Courier New", monospace; }

  h1 { margin: 4px 0 10px 0; font-size: 18px; color: var(--ink); }

  .info-grid {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 24px; margin-bottom: 10px; font-size: 10px;
    background: var(--off-white); border: 1px solid #e2dcd6; border-left: 3px solid var(--burgundy); padding: 8px 10px;
  }
  .info-grid div span.label { color: #666; display: block; font-size: 8px; text-transform: uppercase; letter-spacing: 0.5px; }

  .section { margin-bottom: 14px; }
  .section h2 { font-size: 12px; color: var(--burgundy); border-bottom: 1px solid var(--burgundy); padding-bottom: 3px; margin: 0 0 6px 0; }

  table.items-table { width: 100%; border-collapse: collapse; font-size: 9px; }
  table.items-table th, table.items-table td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  table.items-table th { background: var(--burgundy); color: var(--off-white); font-weight: bold; font-size: 8px; text-transform: uppercase; border-bottom: 2px solid var(--gold); }
  table.items-table tbody tr:nth-child(even) { background: var(--off-white); }
  td.result-cell { font-weight: bold; text-align: center; white-space: nowrap; }
  td.result-pass { color: var(--success); }
  td.result-fail { color: var(--danger); }
  td.result-none { color: #888; }

  .photo-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .photo-tile { margin: 0; width: 31%; break-inside: avoid; }
  .photo-tile img { width: 100%; height: auto; border: 1px solid #ccc; border-radius: 2px; display: block; }
  .photo-tile figcaption { font-size: 7.5px; color: #666; margin-top: 2px; }

  .conclusion-banner {
    display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 4px; margin-bottom: 14px;
    border: 1px solid #ddd;
  }
  .conclusion-banner.pass { background: #eaf6ef; border-color: var(--success); }
  .conclusion-banner.conditional_pass { background: #fdf6e3; border-color: var(--warning); }
  .conclusion-banner.fail { background: #fbeceb; border-color: var(--danger); }
  .conclusion-banner .label { font-size: 8px; text-transform: uppercase; color: #666; display: block; }
  .conclusion-banner .value { font-size: 14px; font-weight: bold; }
  .conclusion-banner.pass .value { color: var(--success); }
  .conclusion-banner.conditional_pass .value { color: var(--warning); }
  .conclusion-banner.fail .value { color: var(--danger); }

  .conclusion { background: var(--off-white); border-left: 3px solid var(--burgundy); padding: 8px 10px; font-size: 10px; line-height: 1.4; }

  .signoff-grid { display: flex; gap: 10px; flex-wrap: wrap; }
  .signoff-card { flex: 1 1 0; min-width: 140px; border: 1px solid #ccc; border-top: 3px solid var(--burgundy); border-radius: 2px; padding: 6px 8px 8px 8px; background: #fff; }
  .signoff-card-label { font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px; color: var(--burgundy); margin-bottom: 4px; }
  .signature-img { height: 32px; max-width: 100%; object-fit: contain; }
  .signoff-card-line { border-bottom: 1px solid #999; margin: 2px 0 4px 0; }
  .signoff-card-name { font-size: 9px; font-weight: bold; }
  .signoff-card-date { font-size: 8px; color: #444; }
  .signoff-card-date span.label { color: #888; text-transform: uppercase; font-size: 7px; margin-right: 4px; }

  .footer-note { margin-top: 16px; padding-top: 6px; border-top: 1px solid #ccc; font-size: 7.5px; color: #666; display: flex; justify-content: space-between; }
</style>
</head>
<body>
${brandColorStyle(data.branding)}
  <div class="letterhead">
    <div class="brand">
      <div class="brand-mark">JA</div>
      <div class="wordmark">JAGS Assurance<small>QUALITY MANAGEMENT &amp; INSPECTION</small></div>
    </div>
    <div class="doc-control">
      <div class="doc-control-title">DOCUMENT CONTROL</div>
      <dl class="doc-control-body">
        <dt>DOC NO.</dt><dd>${escapeHtml(data.assignmentNumber)}</dd>
        <dt>REV</dt><dd>0</dd>
        <dt>GENERATED</dt><dd>${escapeHtml(generatedAtLabel)}</dd>
      </dl>
    </div>
  </div>

  <h1>${escapeHtml(typeLabel)} Report</h1>

  <div class="info-grid">
    <div><span class="label">CLIENT</span>${cell(data.organizationName)}</div>
    <div><span class="label">PROJECT</span>${cell(data.projectName)}</div>
    <div><span class="label">EQUIPMENT</span>${cell(data.equipmentDescription)}</div>
    <div><span class="label">MANUFACTURER / MODEL</span>${cell([data.manufacturer, data.model].filter(Boolean).join(" / ") || null)}</div>
    <div><span class="label">SERIAL / TAG</span>${cell(data.serialTag)}</div>
    <div><span class="label">LOCATION</span>${cell(data.location)}</div>
    <div><span class="label">STANDARD / SPEC</span>${cell(data.standardReference)}</div>
    <div><span class="label">DATE</span>${cell(data.assignmentDate)}</div>
  </div>

  ${
    data.conclusion
      ? `<div class="conclusion-banner ${data.conclusion}">
          <div><span class="label">CONCLUSION</span><span class="value">${escapeHtml(conclusionLabel)}</span></div>
        </div>`
      : ""
  }

  ${data.narrative ? `<div class="section"><h2>Summary</h2><p class="conclusion">${escapeHtml(data.narrative)}</p></div>` : ""}

  ${renderMeasurements(data.measurements)}
  ${renderPunchList(data.punchItems)}
  ${renderPhotos(data.photos)}

  ${data.notes ? `<div class="section"><h2>Notes</h2><p class="conclusion">${escapeHtml(data.notes)}</p></div>` : ""}

  <div class="section">
    <h2>Witnessed By</h2>
    ${renderSignatures(data.signatures)}
  </div>

  <div class="footer-note">
    <span>Doc No. ${escapeHtml(data.assignmentNumber)} &middot; Uncontrolled when printed &middot; jagsassurance.com</span>
    <span>Generated ${escapeHtml(generatedAtLabel)}</span>
  </div>
</body>
</html>`;
}
