// Renders the printable HTML for the one-click "Export portfolio summary (PDF)" report — a single
// JAGS-internal document covering EVERY project across EVERY organisation (unlike
// monthlyReportTemplate.ts, which is scoped to one organisation and one calendar month). Mirrors
// that file's structure and burgundy/gold branding so the two documents read as one family of
// JAGS-issued reports, and mirrors the metrics/logic shown in-app on
// apps/web/app/inspect/organisation/insights/page.tsx (Portfolio Insights) so the PDF and the live
// page never disagree about what a number means. Puppeteer renders this to A4 portrait PDF in
// renderPortfolioSummaryPdf.ts; this module only builds the markup, so it can be eyeballed/tested
// without a browser.

export interface PortfolioSummaryProjectRow {
  projectId: string;
  projectNumber: string;
  projectName: string;
  organizationName: string;
  itpCompletionRate: number | null;
  openNcrs: number;
}

export interface PortfolioSummaryTemplateData {
  projectCount: number;
  organizationCount: number;

  /** Average of each project's (client-accepted / total) ITP completion %, same averaging as Portfolio Insights. */
  avgItpCompletionRate: number | null;

  /** Count of NCRs across the whole portfolio with status not 'closed'. */
  openNcrCount: number;

  /** % of itp_items whose first inspection_record (all-time) passed on the first attempt, portfolio-wide. */
  firstTimePassRate: number | null;
  firstTimePassCounts: { firstAttempts: number; firstTimePasses: number };

  perProject: PortfolioSummaryProjectRow[];

  generatedAt: Date;
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
  if (value === null || value === undefined || value === "") return "&mdash;";
  return typeof value === "number" ? String(value) : escapeHtml(value);
}

function pct(value: number | null): string {
  return value === null ? "&mdash;" : `${value.toFixed(1)}%`;
}

function renderKpiCards(data: PortfolioSummaryTemplateData): string {
  const cards = [
    {
      label: "PROJECTS",
      value: String(data.projectCount),
      sub: `across ${data.organizationCount} organisation${data.organizationCount === 1 ? "" : "s"}`,
    },
    {
      label: "AVG ITP COMPLETION",
      value: pct(data.avgItpCompletionRate),
      sub: "client-accepted / total, averaged per project",
    },
    {
      label: "OPEN NCRS",
      value: String(data.openNcrCount),
      sub: "portfolio-wide, not yet closed",
    },
    {
      label: "FIRST-TIME PASS RATE",
      value: pct(data.firstTimePassRate),
      sub: `${data.firstTimePassCounts.firstTimePasses} / ${data.firstTimePassCounts.firstAttempts} first attempts`,
    },
  ];

  return `<div class="kpi-grid">${cards
    .map(
      (c) => `
      <div class="kpi-card">
        <div class="kpi-label">${escapeHtml(c.label)}</div>
        <div class="kpi-value">${c.value}</div>
        <div class="kpi-sub">${escapeHtml(c.sub)}</div>
      </div>`
    )
    .join("")}</div>`;
}

function renderProjectTable(rows: PortfolioSummaryProjectRow[]): string {
  if (rows.length === 0) {
    return `<p class="empty-note">No projects in the portfolio yet.</p>`;
  }
  const body = rows
    .map(
      (r) => `
      <tr>
        <td>${cell(r.projectNumber)}</td>
        <td>${cell(r.projectName)}</td>
        <td>${cell(r.organizationName)}</td>
        <td>${pct(r.itpCompletionRate)}</td>
        <td>${cell(r.openNcrs)}</td>
      </tr>`
    )
    .join("");
  return `
    <table class="data-table">
      <thead>
        <tr><th>PROJECT NO.</th><th>PROJECT</th><th>ORGANISATION</th><th>ITP COMPLETION</th><th>OPEN NCRS</th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

export function buildPortfolioSummaryHtml(data: PortfolioSummaryTemplateData): string {
  const generatedAtLabel = data.generatedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>JAGS Assurance - Portfolio Summary - ${escapeHtml(generatedAtLabel)}</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }

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
    font-size: 11px;
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
    margin-bottom: 12px;
  }

  .brand { display: flex; align-items: center; gap: 10px; }

  .brand-mark {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--gold);
    color: var(--burgundy);
    font-weight: bold;
    font-size: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .wordmark { font-size: 17px; font-weight: bold; color: #fff; letter-spacing: 0.5px; }

  .wordmark small {
    display: block;
    font-size: 8.5px;
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
    font-size: 8px;
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
    font-size: 9.5px;
  }

  .doc-control-body dt { color: #666; font-size: 8px; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; }
  .doc-control-body dd { margin: 0; font-weight: bold; font-family: "Courier New", monospace; }

  .title-block { margin-bottom: 14px; }
  .title-block h1 { margin: 0 0 4px 0; font-size: 18px; color: var(--ink); }
  .title-block .subline { font-size: 12px; color: #444; }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin-bottom: 16px;
  }

  .kpi-card {
    border: 1px solid #e2dcd6;
    border-top: 3px solid var(--burgundy);
    border-radius: 3px;
    background: #fff;
    padding: 8px 10px;
  }

  .kpi-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.4px; color: #666; }
  .kpi-value { font-size: 16px; font-weight: bold; color: var(--burgundy); margin: 4px 0 2px 0; }
  .kpi-sub { font-size: 8px; color: #777; }

  h2.section-title {
    font-size: 13px;
    color: var(--burgundy);
    border-bottom: 1px solid var(--burgundy);
    padding-bottom: 3px;
    margin: 18px 0 8px 0;
  }

  table.data-table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  table.data-table th, table.data-table td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
  table.data-table th {
    background: var(--burgundy);
    color: var(--off-white);
    font-weight: bold;
    font-size: 9px;
    text-transform: uppercase;
    border-bottom: 2px solid var(--gold);
  }
  table.data-table tbody tr:nth-child(even) { background: var(--off-white); }

  .empty-note { font-size: 10px; color: #777; font-style: italic; }

  .footer-note {
    margin-top: 20px;
    padding-top: 6px;
    border-top: 1px solid #ccc;
    font-size: 8px;
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
      <div class="wordmark">JAGS Assurance<small>QUALITY MANAGEMENT &amp; INSPECTION</small></div>
    </div>
    <div class="doc-control">
      <div class="doc-control-title">DOCUMENT CONTROL</div>
      <dl class="doc-control-body">
        <dt>REPORT TYPE</dt><dd>Portfolio Summary</dd>
        <dt>SCOPE</dt><dd>All organisations</dd>
        <dt>GENERATED</dt><dd>${escapeHtml(generatedAtLabel)}</dd>
      </dl>
    </div>
  </div>

  <div class="title-block">
    <h1>Portfolio Summary</h1>
    <div class="subline">Every client and project &mdash; internal JAGS report, generated ${escapeHtml(generatedAtLabel)}</div>
  </div>

  ${renderKpiCards(data)}

  <h2 class="section-title">By Project</h2>
  ${renderProjectTable(data.perProject)}

  <div class="footer-note">
    <span>Generated by QMP Inspect &mdash; JAGS Assurance. Internal document; not for client distribution.</span>
    <span>Generated ${escapeHtml(generatedAtLabel)}</span>
  </div>
</body>
</html>`;
}
