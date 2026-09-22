// Renders the printable HTML for a general Inspection Report (R63-R65, R108) — the branded A4
// document a client receives for a single completed inspection, distinct from the small IRN
// certificate (which only confirms pass/release). Puppeteer renders this to portrait A4 PDF in
// renderInspectionReportPdf.ts; this module only builds the markup.

export interface InspectionReportResult {
  itemNumber: string;
  description: string;
  result: "yes" | "no" | "na";
  comment: string | null;
}

export interface InspectionReportPhoto {
  caption: string | null;
  /** Already-fetched image bytes as a data: URI — the worker downloads from Storage and inlines
   *  it, so the PDF is a self-contained, permanent record with no dependency on a signed URL. */
  dataUri: string;
}

export interface InspectionReportSignoff {
  label: string;
  name: string | null;
  date: string | null;
}

export interface InspectionReportData {
  recordNumber: string;
  activity: string;
  projectName: string;
  /** Best-effort, only used for the client logo's alt text when branding shows one. */
  organizationName?: string | null;
  itpNumber: string | null;
  location: string | null;
  inspectionDate: string;
  overallResult: "pass" | "fail" | "partial" | null;
  discipline: string | null;
  notes: string | null;
  /** Human-approved AI-drafted (or hand-written) conclusion text, saved via saveInspectionNarrativeAction. Falls back to buildConclusion()'s factual sentence when null. */
  narrative: string | null;
  /** The governing ITP item's `reference_spec` (drawing / specification callout), if the record is
   *  linked to one. Feeds the Traceability table's "Drawing / specification" row; omitted when null. */
  referenceSpec?: string | null;
  /** IRN number already issued against this inspection record, if any — drives the FIELD RESULT
   *  banner's hold-release wording. Null/undefined means no IRN has been issued yet. */
  irnNumber?: string | null;
  results: InspectionReportResult[];
  photos: InspectionReportPhoto[];
  signoffs: InspectionReportSignoff[];
  generatedAt: Date;
  /**
   * Drives the letterhead/footer per the organisation's engagement_mode (Reqs R113-R118) — see
   * orgBranding.ts. Optional/undefined renders exactly as jags_led (today's unchanged branding).
   */
  branding?: InspectionReportBranding;
}

export interface InspectionReportBranding {
  engagementMode: "jags_led" | "co_branded" | "white_label";
  logoUrl: string | null;
}

const RESULT_LABEL: Record<"yes" | "no" | "na", string> = { yes: "PASS", no: "FAIL", na: "N/A" };

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

/** A factual, template-built summary from the record's own real data — not AI-generated, so it
 *  never states anything the record doesn't actually show. */
function buildConclusion(data: InspectionReportData): string {
  const resultLabel = data.overallResult === "pass" ? "PASS" : data.overallResult === "fail" ? "FAIL" : "PARTIAL";
  const scope = data.location ? `${data.activity} within ${data.location}` : data.activity;
  const itpClause = data.itpNumber ? ` in accordance with ${data.itpNumber}` : "";
  const complianceClause =
    data.overallResult === "pass"
      ? "All inspected items comply with the specified requirements."
      : data.overallResult === "fail"
        ? "One or more inspected items did not comply with the specified requirements."
        : "One or more inspected items were recorded as not applicable; see results below.";
  return `The inspection of ${scope} has been completed${itpClause}. ${complianceClause} The inspection status is ${resultLabel}.`;
}

function renderResultsTable(results: InspectionReportResult[]): string {
  const rows = results
    .map(
      (r) => `
        <tr>
          <td class="item-number">${cell(r.itemNumber)}</td>
          <td>${cell(r.description)}</td>
          <td class="result-cell result-${r.result}">${RESULT_LABEL[r.result]}</td>
          <td>${cell(r.comment)}</td>
        </tr>`
    )
    .join("");

  return `
    <table class="items-table">
      <thead>
        <tr><th>No.</th><th>Field-checkable item</th><th>Answer</th><th>Comment/evidence</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** A simple label/value table shown near the top of the document so a reader can immediately place
 *  the record: where it was done, against what drawing/spec, and by whom/when. Rows with no data
 *  (e.g. no linked reference spec) are omitted rather than shown as "—", to keep the table tight. */
function renderTraceabilityTable(data: InspectionReportData): string {
  const inspectorName = data.signoffs[0]?.name ?? null;
  const dateInspector = [data.inspectionDate, inspectorName].filter(Boolean).join(" / ") || null;

  const rows: [string, string | null][] = [
    ["Location", data.location],
    ["Drawing / specification", data.referenceSpec ?? null],
    ["Inspection date / inspector", dateInspector],
  ].filter(([, value]) => Boolean(value)) as [string, string | null][];

  if (rows.length === 0) return "";

  const rowsHtml = rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${cell(value)}</td></tr>`)
    .join("");

  return `
    <table class="traceability-table">
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

/** Builds the excerpt-based reason text for the FIELD RESULT banner directly from the record's own
 *  data — never invents or parses numeric values out of free text, just quotes what the inspector
 *  actually recorded. See buildFieldResultBanner(). */
function buildFieldResultReason(data: InspectionReportData): string {
  const failures = data.results.filter((r) => r.result === "no");

  if (failures.length > 0) {
    const excerpts = failures.map((r) => {
      const label = r.itemNumber ? `Item ${r.itemNumber}` : "Item";
      const desc = r.description ? ` (${r.description})` : "";
      const comment = r.comment ? ` recorded No: ${r.comment}` : " recorded No.";
      return `${label}${desc}${comment}`;
    });
    return excerpts.join(" ");
  }

  if (data.overallResult === "fail") {
    return "One or more items did not meet the acceptance criteria.";
  }

  return "All checklist items met the stated acceptance criteria.";
}

/** The client's expected "FIELD RESULT" callout: a single, unambiguous statement of the outcome,
 *  whether the associated hold has been released (and by which IRN), and the factual reason —
 *  built entirely from the record's own data, never invented. */
function buildFieldResultBanner(data: InspectionReportData): string {
  const resultWord = data.overallResult === "pass" ? "PASS" : data.overallResult === "fail" ? "FAIL" : "PARTIAL";

  let holdClause = "";
  if (data.overallResult === "pass") {
    holdClause = data.irnNumber
      ? ` / HOLD RELEASED — IRN ${escapeHtml(data.irnNumber)} issued.`
      : " / hold release pending IRN issuance.";
  } else if (data.overallResult === "fail") {
    holdClause = " / HOLD NOT RELEASED. IRN issue is blocked.";
  } else if (data.overallResult === "partial") {
    holdClause = " / HOLD NOT RELEASED — inspection incomplete.";
  }

  const reason = escapeHtml(buildFieldResultReason(data));

  return `
    <div class="field-result-banner field-result-${data.overallResult ?? ""}">
      <strong>FIELD RESULT: ${resultWord}${holdClause}</strong>
      <span class="field-result-reason">${reason}</span>
    </div>`;
}

function renderPhotos(photos: InspectionReportPhoto[]): string {
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
  return `
    <div class="section">
      <h2>Evidence Photos</h2>
      <div class="photo-grid">${tiles}</div>
    </div>`;
}

const JAGS_BRAND_BLOCK =
  '<div class="brand-mark">JA</div><div class="wordmark">JAGS ASSURANCE&nbsp;&nbsp;/&nbsp;&nbsp;QMP INSPECT</div>';

/** See itpTemplate.ts's renderBrandBlock — identical semantics, duplicated rather than shared since
 *  the two templates don't share a lib (same convention as PARTY_TYPE_LABEL there). */
function renderBrandBlock(data: InspectionReportData): string {
  const mode = data.branding?.engagementMode ?? "jags_led";
  const logoUrl = data.branding?.logoUrl ?? null;
  if (!logoUrl) return JAGS_BRAND_BLOCK;

  const orgLogo = `<img class="org-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  if (mode === "white_label") return orgLogo;
  if (mode === "co_branded") return `${JAGS_BRAND_BLOCK}<img class="org-logo org-logo-co-branded" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  return JAGS_BRAND_BLOCK;
}

/** The literal R113 requirement — small print in white_label mode only. */
function renderPoweredByFooter(data: InspectionReportData): string {
  if ((data.branding?.engagementMode ?? "jags_led") !== "white_label") return "";
  return '<div class="powered-by">Powered by JAGS Assurance</div>';
}

function renderSignoffs(signoffs: InspectionReportSignoff[]): string {
  const cards = signoffs
    .map(
      (s) => `
        <div class="signoff-card">
          <div class="signoff-card-label">${escapeHtml(s.label)}</div>
          <div class="signoff-card-name">${cell(s.name)}</div>
          <div class="signoff-card-line"></div>
          <div class="signoff-card-date"><span class="label">DATE</span>${cell(s.date)}</div>
        </div>`
    )
    .join("");
  return `<div class="signoff-grid">${cards}</div>`;
}

export function buildInspectionReportHtml(data: InspectionReportData): string {
  const resultLabel = (data.overallResult ?? "in progress").toString().toUpperCase();
  const counts = data.results.reduce(
    (acc, r) => {
      acc[r.result] += 1;
      return acc;
    },
    { yes: 0, no: 0, na: 0 }
  );
  const generatedAtLabel = data.generatedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.recordNumber)}</title>
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
    /* Deliberately NOT bled to the true page edge via a negative margin cancelling @page's margin —
       Chrome's print-to-PDF does not reliably apply that margin the same way twice in a row (visible
       as the logo/wordmark getting clipped), so this sits as a normal box inside the margin, the
       same reliable box model every other section on this page already uses. */
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

  h1 { margin: 4px 0 10px 0; font-size: 18px; color: var(--ink); }

  .info-grid {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 24px;
    margin-bottom: 10px; font-size: 10px;
    background: var(--off-white); border: 1px solid #e2dcd6; border-left: 3px solid var(--burgundy);
    padding: 8px 10px;
  }
  .info-grid div span.label { color: #666; display: block; font-size: 8px; text-transform: uppercase; letter-spacing: 0.5px; }

  .summary-bar {
    display: flex; align-items: center; gap: 18px; margin-bottom: 12px;
    border: 1px solid #e2dcd6; padding: 8px 12px; border-radius: 3px;
  }
  .summary-status { font-size: 15px; font-weight: bold; }
  .summary-status.pass { color: var(--success); }
  .summary-status.fail { color: var(--danger); }
  .summary-stat { font-size: 10px; color: #444; }
  .summary-stat b { display: block; font-size: 14px; color: var(--ink); }

  .section { margin-bottom: 14px; }
  .section h2 {
    font-size: 12px; color: var(--burgundy); border-bottom: 1px solid var(--burgundy);
    padding-bottom: 3px; margin: 0 0 6px 0;
  }

  table.items-table { width: 100%; border-collapse: collapse; font-size: 9px; }
  table.items-table th, table.items-table td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  table.items-table th {
    background: var(--burgundy); color: var(--off-white); font-weight: bold; font-size: 8px;
    text-transform: uppercase; border-bottom: 2px solid var(--gold);
  }
  table.items-table tbody tr:nth-child(even) { background: var(--off-white); }
  td.item-number { white-space: nowrap; font-weight: bold; }
  td.result-cell { font-weight: bold; text-align: center; white-space: nowrap; }
  td.result-yes { color: var(--success); }
  td.result-no { color: var(--danger); }
  td.result-na { color: #888; }

  .photo-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .photo-tile { margin: 0; width: 31%; break-inside: avoid; }
  .photo-tile img { width: 100%; height: auto; border: 1px solid #ccc; border-radius: 2px; display: block; }
  .photo-tile figcaption { font-size: 7.5px; color: #666; margin-top: 2px; }

  .conclusion {
    background: var(--off-white); border-left: 3px solid var(--burgundy);
    padding: 8px 10px; font-size: 10px; line-height: 1.4;
  }

  table.traceability-table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-bottom: 10px; }
  table.traceability-table th, table.traceability-table td {
    border: 1px solid #e2dcd6; padding: 4px 8px; text-align: left; vertical-align: top;
  }
  table.traceability-table th {
    width: 220px; background: var(--off-white); color: #666; font-size: 8px; font-weight: bold;
    text-transform: uppercase; letter-spacing: 0.3px;
  }
  table.traceability-table td { font-weight: bold; }

  .field-result-banner {
    display: flex; flex-direction: column; gap: 3px; margin-bottom: 12px;
    border: 1px solid var(--gold); border-left: 5px solid var(--burgundy);
    background: var(--off-white); border-radius: 3px; padding: 8px 12px; font-size: 11px;
  }
  .field-result-banner strong { font-size: 12px; letter-spacing: 0.2px; }
  .field-result-banner.field-result-pass strong { color: var(--success); }
  .field-result-banner.field-result-fail strong { color: var(--danger); }
  .field-result-banner.field-result-partial strong { color: var(--ink); }
  .field-result-reason { font-size: 9.5px; color: #444; line-height: 1.4; }

  .signoff-grid { display: flex; gap: 10px; flex-wrap: wrap; }
  .signoff-card {
    flex: 1 1 0; min-width: 140px; border: 1px solid #ccc; border-top: 3px solid var(--burgundy);
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
        <dt>DOC NO.</dt><dd>${escapeHtml(data.recordNumber)}</dd>
        <dt>REV</dt><dd>0</dd>
        <dt>GENERATED</dt><dd>${escapeHtml(generatedAtLabel)}</dd>
      </dl>
    </div>
  </div>

  <h1>Inspection Report</h1>

  ${renderTraceabilityTable(data)}

  <div class="info-grid">
    <div><span class="label">PROJECT</span>${cell(data.projectName)}</div>
    <div><span class="label">ITP / PROCEDURE</span>${cell(data.itpNumber)}</div>
    <div><span class="label">ACTIVITY</span>${cell(data.activity)}</div>
    <div><span class="label">DISCIPLINE</span>${cell(data.discipline)}</div>
    <div><span class="label">LOCATION</span>${cell(data.location)}</div>
    <div><span class="label">DATE</span>${cell(data.inspectionDate)}</div>
  </div>

  <div class="summary-bar">
    <div>
      <div class="label" style="font-size:8px;color:#666;text-transform:uppercase;">STATUS</div>
      <div class="summary-status ${data.overallResult ?? ""}">${escapeHtml(resultLabel)}</div>
    </div>
    <div class="summary-stat"><b>${counts.yes + counts.no + counts.na}</b>Checks completed</div>
    <div class="summary-stat"><b>${counts.no}</b>Non-conformances</div>
    <div class="summary-stat"><b>${counts.na}</b>N/A items</div>
  </div>

  <div class="section">
    <h2>Inspection Results</h2>
    ${renderResultsTable(data.results)}
  </div>

  ${renderPhotos(data.photos)}

  ${buildFieldResultBanner(data)}

  <div class="section">
    <h2>Conclusion</h2>
    <p class="conclusion">${escapeHtml(data.narrative || buildConclusion(data))}</p>
  </div>

  ${data.notes ? `<div class="section"><h2>Notes</h2><p class="conclusion">${escapeHtml(data.notes)}</p></div>` : ""}

  <div class="section">
    <h2>Signatures</h2>
    ${renderSignoffs(data.signoffs)}
  </div>

  <div class="footer-note">
    <span>Doc No. ${escapeHtml(data.recordNumber)} &middot; Uncontrolled when printed &middot; jagsassurance.com</span>
    <span>Generated ${escapeHtml(generatedAtLabel)}</span>
  </div>
  ${renderPoweredByFooter(data)}
</body>
</html>`;
}
