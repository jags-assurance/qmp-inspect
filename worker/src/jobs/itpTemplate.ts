// Renders the printable HTML for an ITP (Inspection & Test Plan) — the controlled document JAGS
// issues to a project, prepared/reviewed/approved by JAGS staff then accepted by the client
// (Reqs R66-R81). Puppeteer renders this to landscape A4 PDF in renderItpPdf.ts; this module only
// builds the markup, so it can be eyeballed/tested without a browser.

export interface ItpTemplateParty {
  id: string;
  name: string;
  partyType: string;
}

export interface ItpTemplateIntervention {
  itpItemId: string;
  projectPartyId: string;
  code: "H" | "W" | "R" | "S";
}

/**
 * Whether the party holding this intervention has actually acted on it yet — separate from the
 * intervention code itself (which only ever says who holds what, never whether it happened). Without
 * this, a freshly-approved ITP and a fully-executed one render an identical-looking grid.
 */
export type ItpTemplateSignoffStatus = "pending" | "notified" | "signed_off";

export interface ItpTemplateSignoffCell {
  itpItemId: string;
  projectPartyId: string;
  status: ItpTemplateSignoffStatus;
}

export interface ItpTemplateItem {
  id: string;
  itemNumber: string;
  activity: string;
  referenceSpec: string | null;
  acceptanceCriteria: string | null;
  method: string | null;
  frequency: string | null;
  evidenceType: 1 | 2 | 3;
}

export interface ItpTemplateSection {
  id: string;
  sectionNumber: number;
  title: string;
  items: ItpTemplateItem[];
}

export interface ItpTemplateSignoff {
  label: string;
  name: string | null;
  date: string | null;
}

export interface ItpTemplateData {
  itpNumber: string;
  title: string;
  scope: string | null;
  applicableStandard: string | null;
  revision: number;
  status: string;
  organizationName: string;
  projectName: string;
  projectNumber: string;
  parties: ItpTemplateParty[];
  sections: ItpTemplateSection[];
  interventions: ItpTemplateIntervention[];
  signoffStatuses: ItpTemplateSignoffCell[];
  signoffs: ItpTemplateSignoff[];
  generatedAt: Date;
}

const EVIDENCE_TYPE_LABEL: Record<1 | 2 | 3, string> = {
  1: "Checklist",
  2: "Document Upload",
  3: "Measurement Record",
};

const INTERVENTION_LABEL: Record<"H" | "W" | "R" | "S", string> = {
  H: "Hold",
  W: "Witness",
  R: "Review",
  S: "Surveillance",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  under_review: "Under Review",
  approved: "Approved",
  client_accepted: "Client Accepted",
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

const SIGNOFF_STATUS_LABEL: Record<ItpTemplateSignoffStatus, string> = {
  pending: "Pending — not yet notified",
  notified: "Notified — awaiting sign-off",
  signed_off: "Signed off",
};

// Appended to the intervention letter so a freshly-approved ITP and a fully-executed one don't
// render an identical grid. Plain ASCII/common-Unicode marks only, since they need to survive
// Puppeteer's default font rendering: a check for done, a tilde for in-progress, nothing for
// not-yet-started (the letter alone already reads as "not started" without extra noise).
const SIGNOFF_STATUS_MARK: Record<ItpTemplateSignoffStatus, string> = {
  pending: "",
  notified: "~",
  signed_off: "✓",
};

function interventionCell(
  code: "H" | "W" | "R" | "S" | undefined,
  status: ItpTemplateSignoffStatus | undefined
): string {
  if (!code) return '<td class="intervention-cell intervention-none">&mdash;</td>';
  const effectiveStatus = status ?? "pending";
  const mark = SIGNOFF_STATUS_MARK[effectiveStatus];
  const title = `${INTERVENTION_LABEL[code]} — ${SIGNOFF_STATUS_LABEL[effectiveStatus]}`;
  return `<td class="intervention-cell intervention-${code} signoff-${effectiveStatus}" title="${title}">${code}${mark ? `<span class="signoff-mark">${mark}</span>` : ""}</td>`;
}

function renderSection(
  section: ItpTemplateSection,
  parties: ItpTemplateParty[],
  interventions: ItpTemplateIntervention[],
  signoffStatuses: ItpTemplateSignoffCell[]
): string {
  const interventionByItem = new Map<string, Map<string, "H" | "W" | "R" | "S">>();
  for (const iv of interventions) {
    if (!interventionByItem.has(iv.itpItemId)) interventionByItem.set(iv.itpItemId, new Map());
    interventionByItem.get(iv.itpItemId)!.set(iv.projectPartyId, iv.code);
  }

  const statusByItem = new Map<string, Map<string, ItpTemplateSignoffStatus>>();
  for (const s of signoffStatuses) {
    if (!statusByItem.has(s.itpItemId)) statusByItem.set(s.itpItemId, new Map());
    statusByItem.get(s.itpItemId)!.set(s.projectPartyId, s.status);
  }

  const rows = section.items
    .map((item) => {
      const partyCells = parties
        .map((party) =>
          interventionCell(interventionByItem.get(item.id)?.get(party.id), statusByItem.get(item.id)?.get(party.id))
        )
        .join("");
      return `
        <tr>
          <td class="item-number">${cell(item.itemNumber)}</td>
          <td class="activity">${cell(item.activity)}</td>
          <td>${cell(item.referenceSpec)}</td>
          <td>${cell(item.acceptanceCriteria)}</td>
          <td>${cell(item.method)}</td>
          <td>${cell(item.frequency)}</td>
          <td>${escapeHtml(EVIDENCE_TYPE_LABEL[item.evidenceType])}</td>
          ${partyCells}
        </tr>`;
    })
    .join("");

  const partyHeaders = parties
    .map((party) => `<th class="party-header">${escapeHtml(party.name)}<span class="party-type">${escapeHtml(party.partyType)}</span></th>`)
    .join("");

  return `
    <section class="itp-section">
      <h2>Section ${section.sectionNumber}: ${escapeHtml(section.title)}</h2>
      <table class="items-table">
        <thead>
          <tr>
            <th>Item No.</th>
            <th>Activity</th>
            <th>Reference</th>
            <th>Acceptance Criteria</th>
            <th>Method</th>
            <th>Frequency</th>
            <th>Evidence Type</th>
            ${partyHeaders}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderLegend(): string {
  return `
    <div class="legend">
      <span class="legend-item"><span class="legend-swatch intervention-H"></span>H &ndash; Hold</span>
      <span class="legend-item"><span class="legend-swatch intervention-W"></span>W &ndash; Witness</span>
      <span class="legend-item"><span class="legend-swatch intervention-R"></span>R &ndash; Review</span>
      <span class="legend-item"><span class="legend-swatch intervention-S"></span>S &ndash; Surveillance</span>
      <span class="legend-item legend-signoff">${SIGNOFF_STATUS_MARK.signed_off} Signed off &nbsp;&nbsp; ${SIGNOFF_STATUS_MARK.notified} Notified, awaiting sign-off &nbsp;&nbsp; (no mark) Not yet notified</span>
    </div>`;
}

function renderSignoffs(signoffs: ItpTemplateSignoff[]): string {
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

export function buildItpHtml(data: ItpTemplateData): string {
  const statusLabel = STATUS_LABEL[data.status] ?? data.status;
  const sectionsHtml = data.sections
    .map((s) => renderSection(s, data.parties, data.interventions, data.signoffStatuses))
    .join("");
  const generatedAtLabel = data.generatedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.itpNumber)}</title>
<style>
  @page { size: A4 landscape; margin: 15mm; }

  :root {
    --burgundy: #6B1E2C;
    --gold: #F5C518;
    --off-white: #F9F7F4;
    --ink: #1C1C1E;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: Arial, Helvetica, sans-serif;
    color: var(--ink);
    background: var(--off-white);
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

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .brand-mark {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--gold);
    color: var(--burgundy);
    font-weight: bold;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .wordmark {
    font-size: 16px;
    font-weight: bold;
    color: #fff;
    letter-spacing: 0.5px;
  }

  .wordmark small {
    display: block;
    font-size: 8px;
    font-weight: normal;
    color: var(--gold);
    letter-spacing: 1.5px;
    text-transform: uppercase;
  }

  .doc-control {
    background: var(--off-white);
    border: 1px solid var(--gold);
    border-radius: 3px;
    min-width: 190px;
  }

  .doc-control-title {
    background: var(--gold);
    color: var(--ink);
    font-size: 7.5px;
    font-weight: bold;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    padding: 2px 8px;
  }

  .doc-control-body {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 8px;
    padding: 4px 8px 5px 8px;
    font-size: 9px;
    color: var(--ink);
  }

  .doc-control-body dt {
    color: #666;
    font-size: 7.5px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    white-space: nowrap;
  }

  .doc-control-body dd {
    margin: 0;
    font-weight: bold;
    font-family: "Courier New", monospace;
  }

  .title-block {
    margin-bottom: 10px;
  }

  .title-block h1 {
    margin: 0 0 4px 0;
    font-size: 16px;
    color: var(--ink);
  }

  .title-block .subline {
    font-size: 11px;
    color: #444;
  }

  .status-badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 3px;
    background: var(--gold);
    color: var(--ink);
    font-weight: bold;
    font-size: 10px;
    margin-left: 6px;
    text-transform: uppercase;
  }

  .info-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 24px;
    margin-bottom: 10px;
    font-size: 10px;
    background: var(--off-white);
    border: 1px solid #e2dcd6;
    border-left: 3px solid var(--burgundy);
    padding: 6px 10px;
  }

  .info-grid div span.label {
    color: #666;
    display: block;
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .itp-section {
    margin-bottom: 12px;
    break-inside: avoid;
  }

  .itp-section h2 {
    font-size: 12px;
    color: var(--burgundy);
    border-bottom: 1px solid var(--burgundy);
    padding-bottom: 3px;
    margin: 0 0 6px 0;
  }

  table.items-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8.5px;
  }

  table.items-table thead {
    display: table-header-group;
  }

  table.items-table th, table.items-table td {
    border: 1px solid #ccc;
    padding: 3px 4px;
    text-align: left;
    vertical-align: top;
  }

  table.items-table th {
    background: var(--burgundy);
    color: var(--off-white);
    font-weight: bold;
    font-size: 8px;
    text-transform: uppercase;
    border-bottom: 2px solid var(--gold);
  }

  table.items-table tbody tr:nth-child(even) {
    background: var(--off-white);
  }

  table.items-table tbody tr:hover {
    background: #efe9e6;
  }

  th.party-header {
    text-align: center;
    min-width: 26px;
  }

  th.party-header .party-type {
    display: block;
    font-weight: normal;
    text-transform: capitalize;
    font-size: 6.5px;
    opacity: 0.85;
  }

  td.item-number {
    white-space: nowrap;
    font-weight: bold;
  }

  td.activity {
    min-width: 90px;
  }

  td.intervention-cell {
    text-align: center;
    font-weight: bold;
    width: 22px;
  }

  .intervention-H { background: #E5555A; color: #fff; }
  .intervention-W { background: #F5C518; color: var(--ink); }
  .intervention-R { background: #4C7EA8; color: #fff; }
  .intervention-S { background: #9AA0A6; color: #fff; }
  .intervention-none { color: #bbb; }

  /* Sign-off completion, layered on top of the intervention color above: a pending cell (holder
     assigned but not yet notified) is dimmed so it reads as "not started"; a notified cell gets a
     dashed outline (in progress); a signed-off cell stays full-strength with a check mark. Without
     this a freshly-approved ITP and a fully-executed one would render an identical-looking grid. */
  .intervention-cell.signoff-pending { opacity: 0.45; }
  .intervention-cell.signoff-notified { outline: 1.5px dashed var(--ink); outline-offset: -2px; }
  .signoff-mark {
    display: inline-block;
    margin-left: 2px;
    font-size: 7px;
  }

  .legend {
    display: flex;
    gap: 14px;
    margin: 6px 0 14px 0;
    font-size: 8px;
    flex-wrap: wrap;
  }

  .legend-signoff {
    color: #555;
    border-left: 1px solid #ccc;
    padding-left: 14px;
  }

  .legend-item { display: flex; align-items: center; gap: 4px; }

  .legend-swatch {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 2px;
  }

  .signoff-block {
    margin-top: 20px;
    break-inside: avoid;
  }

  .signoff-block h2 {
    font-size: 11px;
    color: var(--burgundy);
    margin: 0 0 6px 0;
  }

  .signoff-grid {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .signoff-card {
    flex: 1 1 0;
    min-width: 140px;
    border: 1px solid #ccc;
    border-top: 3px solid var(--burgundy);
    border-radius: 2px;
    padding: 6px 8px 8px 8px;
    background: #fff;
  }

  .signoff-card-label {
    font-size: 8px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--burgundy);
    margin-bottom: 10px;
  }

  .signoff-card-name {
    font-size: 10px;
    font-weight: bold;
    min-height: 12px;
  }

  .signoff-card-line {
    border-bottom: 1px solid #999;
    margin: 14px 0 4px 0;
  }

  .signoff-card-date {
    font-size: 8px;
    color: #444;
  }

  .signoff-card-date span.label {
    color: #888;
    text-transform: uppercase;
    font-size: 7px;
    margin-right: 4px;
  }

  .footer-note {
    margin-top: 16px;
    padding-top: 6px;
    border-top: 1px solid #ccc;
    font-size: 7.5px;
    color: #666;
    display: flex;
    justify-content: space-between;
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
        <dt>Doc No.</dt><dd>${escapeHtml(data.itpNumber)}</dd>
        <dt>Revision</dt><dd>${data.revision}</dd>
        <dt>Status</dt><dd>${escapeHtml(statusLabel)}</dd>
        <dt>Generated</dt><dd>${escapeHtml(generatedAtLabel)}</dd>
      </dl>
    </div>
  </div>

  <div class="title-block">
    <h1>${escapeHtml(data.title)}<span class="status-badge">${escapeHtml(statusLabel)}</span></h1>
    <div class="subline">${escapeHtml(data.organizationName)} &mdash; ${escapeHtml(data.projectName)} (${escapeHtml(data.projectNumber)})</div>
  </div>

  <div class="info-grid">
    <div><span class="label">Scope</span>${cell(data.scope)}</div>
    <div><span class="label">Applicable Standard</span>${cell(data.applicableStandard)}</div>
    <div><span class="label">Revision</span>${data.revision}</div>
    <div><span class="label">Status</span>${escapeHtml(statusLabel)}</div>
  </div>

  ${renderLegend()}

  ${sectionsHtml}

  <div class="signoff-block">
    <h2>Revision &amp; Approval</h2>
    ${renderSignoffs(data.signoffs)}
  </div>

  <div class="footer-note">
    <span>Generated by QMP Inspect &mdash; JAGS Assurance</span>
    <span>Generated ${escapeHtml(generatedAtLabel)}</span>
  </div>
</body>
</html>`;
}
