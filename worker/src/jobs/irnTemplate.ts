import { brandColorStyle } from "./orgBranding";
// Renders the printable HTML for a single IRN (Inspection Release Note) certificate — the branded
// A4 document that confirms an activity has passed inspection and its hold has been released.
// Puppeteer renders this to portrait A4 PDF in renderIrnPdf.ts; this module only builds the markup.
// Mirrors ncrTemplate.ts's letterhead/doc-control/table conventions exactly, just for IRN data
// instead of NCR data — a small certificate rather than a dossier, so it carries one field-value
// table plus a signed-off-by block instead of two.

export interface IrnPdfData {
  irnNumber: string;
  projectName: string;
  organizationName: string | null;

  // The activity this IRN releases, and the inspection record it's based on.
  activity: string;
  itpNumber: string | null;
  inspectionRecordNumber: string;
  inspectionDate: string;
  location: string | null;
  overallResult: "pass" | "fail" | "partial" | null;
  inspectorName: string | null;
  /** Inspector's captured signature (data: URL PNG) and when it was applied. */
  inspectorSignatureDataUri?: string | null;
  inspectorSignedAt?: string | null;
  witnessName?: string | null;
  witnessSignatureDataUri?: string | null;
  /** Vault revision this render will be filed as, so the printed REV matches the vault. */
  revision?: string | null;

  // Release
  releaseDate: string;
  issuedByName: string | null;

  /** Set when the IRN has been voided (row kept, flagged). */
  voidedAt?: string | null;
  voidReason?: string | null;
  approvals?: IrnApproval[];
  generatedAt: Date;
  /**
   * Drives the letterhead/footer per the organisation's engagement_mode (Reqs R113-R118) — see
   * orgBranding.ts. Optional/undefined renders exactly as jags_led (today's unchanged branding).
   */
  branding?: IrnPdfBranding;
}

export interface IrnApproval {
  label: string;
  organisation: string | null;
  signerName: string | null;
  signatureDataUri: string | null;
  date: string | null;
}

export interface IrnPdfBranding {
  engagementMode: "jags_led" | "co_branded" | "white_label";
  logoUrl: string | null;
  brandPrimaryColor?: string | null;
  brandAccentColor?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function renderApprovalCard(label: string, org: string | null, name: string | null, sig: string | null, date: string | null): string {
  const img = sig && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(sig) ? `<img class="signature-img" src="${sig}" alt="signature" />` : "";
  return `<div class="signoff-card">
    <div class="signoff-card-label">${escapeHtml(label)}</div>
    <div class="signoff-card-org">${org ? escapeHtml(org) : "&nbsp;"}</div>
    ${img}
    <div class="signoff-card-line"></div>
    <div class="signoff-card-name">${name ? escapeHtml(name) : "&nbsp;"}</div>
    <div class="signoff-card-date"><span class="label">DATE</span>${date ? escapeHtml(date) : "____________"}</div>
  </div>`;
}

function cell(value: string | null | undefined): string {
  return value ? escapeHtml(value) : "&mdash;";
}

/** Same Field | Value table shape as ncrTemplate.ts's renderFieldValueTable. */
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
function renderBrandBlock(data: IrnPdfData): string {
  const mode = data.branding?.engagementMode ?? "jags_led";
  const logoUrl = data.branding?.logoUrl ?? null;
  if (!logoUrl) return JAGS_BRAND_BLOCK;

  const orgLogo = `<img class="org-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  if (mode === "white_label") return orgLogo;
  if (mode === "co_branded") return `${JAGS_BRAND_BLOCK}<img class="org-logo org-logo-co-branded" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  return JAGS_BRAND_BLOCK;
}

/** The literal R113 requirement — small print in white_label mode only. */
function renderPoweredByFooter(data: IrnPdfData): string {
  if ((data.branding?.engagementMode ?? "jags_led") !== "white_label") return "";
  return '<div class="powered-by">Powered by JAGS Assurance</div>';
}

export function buildIrnPdfHtml(data: IrnPdfData): string {
  const generatedAtLabel = data.generatedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const projectSubline = [data.organizationName, data.projectName].filter(Boolean).join(" · ");
  // Never default a missing result to PASS.
  const resultLabel = data.overallResult ? data.overallResult.toUpperCase() : "NOT RECORDED";
  const isPartial = data.overallResult === "partial";
  const releaseTitle = data.voidedAt ? "HOLD RELEASE VOIDED" : isPartial ? "CONDITIONAL RELEASE" : "HOLD RELEASED";
  const releaseText = isPartial
    ? "This certificate confirms the activity below has been inspected with a PARTIAL result; the hold is released conditionally, subject to the outstanding items being closed out."
    : "This certificate confirms the activity below has been inspected, passed, and its hold released for the next stage of work.";
  const releaseStatus = data.voidedAt ? "VOID" : isPartial ? "CONDITIONAL RELEASE" : "RELEASED";

  const activityRows: [string, string | null][] = [
    ["Activity", data.activity],
    ["Governing ITP", data.itpNumber],
    ["Inspection record", data.inspectionRecordNumber],
    ["Inspection date", data.inspectionDate],
    ["Location", formatLocation(data.location)],
    ["Result", resultLabel],
  ];

  const releaseRows: [string, string | null][] = [
    ["Hold status", releaseStatus],
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.irnNumber)}</title>
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
    border-bottom: 2px solid var(--gold);
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

  .void-banner { border: 3px solid #c00; color: #c00; text-align: center; padding: 10px; margin-bottom: 12px; border-radius: 3px; }
  .void-banner strong { display: block; font-size: 44px; letter-spacing: 8px; }
  .void-banner span { font-size: 11px; color: #800; }
  .void-watermark { position: fixed; top: 38%; left: 0; right: 0; text-align: center; font-size: 160px; font-weight: bold; color: rgba(204, 0, 0, 0.12); transform: rotate(-30deg); z-index: 0; pointer-events: none; }

  .section { margin-bottom: 10px; }
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

  .approvals { break-inside: avoid; page-break-inside: avoid; margin-bottom: 6px; }
  .approvals h2 { break-after: avoid; page-break-after: avoid; }
  .released-by { font-size: 9px; margin: 6px 0 0 0; }
  .signature-img { height: 30px; max-width: 100%; object-fit: contain; display: block; }
  .signoff-card-org { font-size: 8.5px; color: #444; min-height: 11px; margin-bottom: 4px; }
  .signoff-grid { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; break-inside: avoid; page-break-inside: avoid; }
  .signoff-card {
    flex: 1 1 28%; min-width: 150px; break-inside: avoid; page-break-inside: avoid; border: 1px solid #ccc; border-top: 3px solid var(--burgundy);
    border-radius: 2px; padding: 6px 8px 8px 8px; background: #fff;
  }
  .signoff-card-label { font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px; color: var(--burgundy); margin-bottom: 4px; }
  .signoff-card-name { font-size: 10px; font-weight: bold; min-height: 12px; }
  .signoff-card-line { border-bottom: 1px solid #999; margin: 14px 0 4px 0; }
  .signoff-card-date { font-size: 8px; color: #444; }
  .signoff-card-date span.label { color: #888; text-transform: uppercase; font-size: 7px; margin-right: 4px; }

  .footer-note {
    margin-top: 8px; padding-top: 6px; border-top: 1px solid #ccc;
    font-size: 7.5px; color: #666; display: flex; justify-content: space-between;
  }
</style>
</head>
<body>
${brandColorStyle(data.branding)}
  <div class="letterhead">
    <div class="brand">
      ${renderBrandBlock(data)}
    </div>
    <div class="doc-control">
      <div class="doc-control-title">DOCUMENT CONTROL</div>
      <dl class="doc-control-body">
        <dt>DOC NO.</dt><dd>${escapeHtml(data.irnNumber)}</dd>
        <dt>REV</dt><dd>Rev ${escapeHtml(data.revision ?? "0")}</dd>
        <dt>ISSUE DATE</dt><dd>${escapeHtml(data.releaseDate)}</dd>
        <dt>STATUS</dt><dd>${escapeHtml(releaseStatus)}</dd>
      </dl>
    </div>
  </div>

  <h1>${escapeHtml(data.irnNumber)} | Inspection Release Note</h1>
  <p class="subline">${cell(projectSubline || null)}</p>

  ${
    data.voidedAt
      ? `<div class="void-banner"><strong>VOID</strong><span>This IRN has been voided and is no longer valid. Voided ${escapeHtml(data.voidedAt.slice(0, 10))}. Reason: ${cell(data.voidReason)}</span></div><div class="void-watermark">VOID</div>`
      : ""
  }

  <div class="release-banner">
    <strong>${releaseTitle} — ${escapeHtml(resultLabel)}</strong>
    <span>${escapeHtml(releaseText)}</span>
  </div>

  ${renderFieldValueTable("Activity & inspection", activityRows)}

  ${renderFieldValueTable("Release", releaseRows)}

  <div class="section approvals">
    <h2>Approvals</h2>
    <div class="signoff-grid">
      ${renderApprovalCard("JAGS INSPECTOR", "JAGS Assurance", data.inspectorName, data.inspectorSignatureDataUri ?? null, data.inspectorSignedAt ? data.inspectorSignedAt.slice(0, 10) : data.inspectionDate)}
      ${data.witnessName || data.witnessSignatureDataUri ? renderApprovalCard("WITNESS", null, data.witnessName ?? null, data.witnessSignatureDataUri ?? null, data.inspectorSignedAt ? data.inspectorSignedAt.slice(0, 10) : null) : ""}
      ${(data.approvals ?? []).map((a) => renderApprovalCard(a.label, a.organisation, a.signerName, a.signatureDataUri, a.date)).join("")}
    </div>
    <p class="released-by">Released by: <strong>${cell(data.issuedByName)}</strong> on ${cell(data.releaseDate)}</p>
  </div>

  <div class="footer-note">
    <span>Doc No. ${escapeHtml(data.irnNumber)} &middot; Uncontrolled when printed &middot; jagsassurance.com</span>
    <span>Generated ${escapeHtml(generatedAtLabel)}</span>
  </div>
  ${renderPoweredByFooter(data)}
</body>
</html>`;
}
