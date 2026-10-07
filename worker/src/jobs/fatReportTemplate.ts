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
  branding?: {
    engagementMode?: "jags_led" | "co_branded" | "white_label";
    logoUrl?: string | null;
    brandPrimaryColor?: string | null;
    brandAccentColor?: string | null;
  };
  /** Vault revision this render will be filed as, so the printed REV matches the vault. */
  revision?: string | null;
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
  /** Project parties (name + party_type) used to build the approval boxes. */
  parties?: { name: string; partyType: string }[];
  generatedAt: Date;
  /** Assignment lifecycle state - anything but 'completed' is rendered with a DRAFT watermark. */
  status: "draft" | "conditional_open" | "completed";
  clearance: { number: string | null; notes: string | null; clearedAt: string; clearedBy: string | null } | null;
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

const FAT_JAGS_BRAND_BLOCK = `<div class="brand-mark">JA</div>
      <div class="wordmark">JAGS Assurance<small>QUALITY MANAGEMENT &amp; INSPECTION</small></div>`;

function renderFatBrandBlock(data: FatReportData): string {
  const mode = data.branding?.engagementMode ?? "jags_led";
  const logoUrl = data.branding?.logoUrl ?? null;
  if (!logoUrl || mode === "jags_led") return FAT_JAGS_BRAND_BLOCK;
  const img = `<img class="org-logo${mode === "co_branded" ? " org-logo-co-branded" : ""}" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  return mode === "white_label" ? img : `${FAT_JAGS_BRAND_BLOCK}${img}`;
}

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

/** Coordinates only when the value holds a decimal pair (last pair wins); otherwise the value as is. */
function formatLocation(value: string | null): string | null {
  if (!value) return null;
  const re = /(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) last = m;
  return last ? `Lat ${last[1]}, Long ${last[2]}` : value;
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

const SIG_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

function fmtSigned(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function approvalCard(label: string, org: string | null, sig: FatReportSignature | null): string {
  const img = sig && SIG_RE.test(sig.signatureDataUri) ? `<img class="signature-img" src="${sig.signatureDataUri}" alt="signature" />` : "";
  return `
        <div class="signoff-card">
          <div class="signoff-card-label">${escapeHtml(label)}</div>
          <div class="signoff-card-org">${org ? escapeHtml(org) : "&nbsp;"}</div>
          ${img}
          <div class="signoff-card-line"></div>
          <div class="signoff-card-name">${sig ? escapeHtml(sig.signatoryName) : "&nbsp;"}</div>
          <div class="signoff-card-date"><span class="label">DATE</span>${sig ? escapeHtml(fmtSigned(sig.signedAt)) : "____________"}</div>
        </div>`;
}

/** Maps recorded witness signatures onto the project's party boxes by role text; the rest are "Additional witnesses". */
function renderApprovals(data: FatReportData): string {
  const BOXES: { type: string; label: string; re: RegExp }[] = [
    { type: "client", label: "CLIENT REPRESENTATIVE", re: /client|owner/i },
    { type: "main_contractor", label: "MAIN CONTRACTOR", re: /main\s*contractor|\bepc\b/i },
    { type: "subcontractor", label: "SUBCONTRACTOR", re: /sub\s*-?\s*contractor|vendor|supplier|manufacturer/i },
    { type: "tpi_lab", label: "TPI / LAB", re: /tpi|third\s*party|\blab/i },
  ];
  const remaining = [...data.signatures];
  const take = (re: RegExp): FatReportSignature | null => {
    const i = remaining.findIndex((s) => re.test(s.role));
    return i >= 0 ? remaining.splice(i, 1)[0] : null;
  };
  const parties = data.parties ?? [];
  const cards: string[] = [];
  const jags = take(/jags|inspector/i);
  cards.push(approvalCard("JAGS INSPECTOR", "JAGS Assurance", jags));
  for (const box of BOXES) {
    const orgs = parties.filter((p) => p.partyType === box.type).map((p) => p.name);
    const sig = take(box.re);
    if (orgs.length === 0 && !sig) continue;
    cards.push(approvalCard(box.label, orgs.join(", ") || null, sig));
  }
  const extra = remaining.length
    ? `<div class="additional-witnesses"><div class="signoff-card-label">ADDITIONAL WITNESSES</div><div class="signoff-grid">${remaining
        .map((s) => approvalCard(s.role, null, s))
        .join("")}</div></div>`
    : "";
  return `<div class="signoff-grid">${cards.join("")}</div>${extra}`;
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
  .org-logo { max-height: 34px; max-width: 160px; object-fit: contain; }
  .org-logo-co-branded { padding-left: 10px; border-left: 1px solid rgba(255, 255, 255, 0.3); }
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

  .section { margin-bottom: 10px; }
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

  .approvals { break-inside: avoid; page-break-inside: avoid; }
  .approvals h2 { break-after: avoid; page-break-after: avoid; }
  .signoff-card-org { font-size: 8.5px; color: #444; min-height: 11px; margin-bottom: 4px; }
  .additional-witnesses { margin-top: 8px; break-inside: avoid; page-break-inside: avoid; }
  .signoff-grid { display: flex; gap: 8px; flex-wrap: wrap; break-inside: avoid; page-break-inside: avoid; }
  .signoff-card { flex: 1 1 28%; min-width: 140px; break-inside: avoid; page-break-inside: avoid; border: 1px solid #ccc; border-top: 3px solid var(--burgundy); border-radius: 2px; padding: 6px 8px 8px 8px; background: #fff; }
  .signoff-card-label { font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px; color: var(--burgundy); margin-bottom: 4px; }
  .signature-img { height: 32px; max-width: 100%; object-fit: contain; }
  .signoff-card-line { border-bottom: 1px solid #999; margin: 2px 0 4px 0; }
  .signoff-card-name { font-size: 9px; font-weight: bold; }
  .signoff-card-date { font-size: 8px; color: #444; }
  .signoff-card-date span.label { color: #888; text-transform: uppercase; font-size: 7px; margin-right: 4px; }

  .watermark { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 90px; font-weight: bold; color: rgba(179, 38, 30, 0.12); transform: rotate(-30deg); z-index: 0; pointer-events: none; letter-spacing: 8px; }
  .clearance-box { border: 1px solid var(--success); background: #eaf6ef; border-radius: 3px; padding: 8px 10px; font-size: 10px; line-height: 1.4; }
  .clearance-box.pending { border-color: var(--warning); background: #fdf6e3; }

  .footer-note { margin-top: 8px; padding-top: 6px; border-top: 1px solid #ccc; font-size: 7.5px; color: #666; display: flex; justify-content: space-between; }
</style>
</head>
<body>
${brandColorStyle(data.branding)}
  ${data.status === "completed" ? "" : `<div class="watermark">${data.status === "draft" ? "DRAFT" : "NOT CLEARED"}</div>`}
  <div class="letterhead">
    <div class="brand">${renderFatBrandBlock(data)}</div>
    <div class="doc-control">
      <div class="doc-control-title">DOCUMENT CONTROL</div>
      <dl class="doc-control-body">
        <dt>DOC NO.</dt><dd>${escapeHtml(data.assignmentNumber)}</dd>
        <dt>REV</dt><dd>Rev ${escapeHtml(data.revision ?? "0")}</dd>
        <dt>ISSUE DATE</dt><dd>${escapeHtml(data.assignmentDate ?? data.generatedAt.toISOString().slice(0, 10))}</dd>
        <dt>STATUS</dt><dd>${data.status === "completed" ? "COMPLETED" : data.status === "draft" ? "DRAFT" : "NOT CLEARED"}</dd>
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
    <div><span class="label">LOCATION</span>${cell(formatLocation(data.location))}</div>
    <div><span class="label">STANDARD / SPEC</span>${cell(data.standardReference)}</div>
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
  ${
    data.clearance
      ? `<div class="section"><h2>Clearance</h2><div class="clearance-box">
          <strong>CLEARANCE ISSUED${data.clearance.number ? " &mdash; " + escapeHtml(data.clearance.number) : ""}</strong><br/>
          By ${cell(data.clearance.clearedBy)} on ${escapeHtml(new Date(data.clearance.clearedAt).toISOString().replace("T", " ").slice(0, 16))} UTC
          ${data.clearance.notes ? `<br/>${escapeHtml(data.clearance.notes)}` : ""}
        </div></div>`
      : data.status === "conditional_open"
        ? `<div class="section"><h2>Clearance</h2><div class="clearance-box pending"><strong>PENDING</strong> &mdash; conditional pass; clearance has not yet been issued. Outstanding punch items must be closed first.</div></div>`
        : ""
  }
  ${renderPhotos(data.photos)}

  ${data.notes ? `<div class="section"><h2>Notes</h2><p class="conclusion">${escapeHtml(data.notes)}</p></div>` : ""}

  <div class="section approvals">
    <h2>Approvals</h2>
    ${renderApprovals(data)}
  </div>

  <div class="footer-note">
    <span>Doc No. ${escapeHtml(data.assignmentNumber)} &middot; Uncontrolled when printed &middot; jagsassurance.com</span>
    <span>Generated ${escapeHtml(generatedAtLabel)}</span>
  </div>
</body>
</html>`;
}
