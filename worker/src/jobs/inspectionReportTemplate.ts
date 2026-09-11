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
  itpNumber: string | null;
  location: string | null;
  inspectionDate: string;
  overallResult: "pass" | "fail" | "partial" | null;
  discipline: string | null;
  notes: string | null;
  /** Human-approved AI-drafted (or hand-written) conclusion text, saved via saveInspectionNarrativeAction. Falls back to buildConclusion()'s factual sentence when null. */
  narrative: string | null;
  results: InspectionReportResult[];
  photos: InspectionReportPhoto[];
  signoffs: InspectionReportSignoff[];
  generatedAt: Date;
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
        <tr><th>Item</th><th>Inspection point</th><th>Result</th><th>Comment / measurement</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
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

function renderSignoffs(signoffs: InspectionReportSignoff[]): string {
  const cards = signoffs
    .map(
      (s) => `
        <div class="signoff-card">
          <div class="signoff-card-label">${escapeHtml(s.label)}</div>
          <div class="signoff-card-name">${cell(s.name)}</div>
          <div class="signoff-card-line"></div>
          <div class="signoff-card-date"><span class="label">Date</span>${cell(s.date)}</div>
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
    padding: 8px 12px;
    margin: -15mm -15mm 10px -15mm;
    padding-left: calc(15mm - 4px);
    padding-right: 15mm;
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
      <div class="brand-mark">JA</div>
      <div class="wordmark">JAGS Assurance<small>Quality Management &amp; Inspection</small></div>
    </div>
    <div class="doc-control">
      <div class="doc-control-title">Document Control</div>
      <dl class="doc-control-body">
        <dt>Doc No.</dt><dd>${escapeHtml(data.recordNumber)}</dd>
        <dt>Rev</dt><dd>0</dd>
        <dt>Generated</dt><dd>${escapeHtml(generatedAtLabel)}</dd>
      </dl>
    </div>
  </div>

  <h1>Inspection Report</h1>

  <div class="info-grid">
    <div><span class="label">Project</span>${cell(data.projectName)}</div>
    <div><span class="label">ITP / Procedure</span>${cell(data.itpNumber)}</div>
    <div><span class="label">Activity</span>${cell(data.activity)}</div>
    <div><span class="label">Discipline</span>${cell(data.discipline)}</div>
    <div><span class="label">Location</span>${cell(data.location)}</div>
    <div><span class="label">Date</span>${cell(data.inspectionDate)}</div>
  </div>

  <div class="summary-bar">
    <div>
      <div class="label" style="font-size:8px;color:#666;text-transform:uppercase;">Status</div>
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
</body>
</html>`;
}
