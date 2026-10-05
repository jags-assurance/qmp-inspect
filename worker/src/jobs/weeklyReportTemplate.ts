import { brandColorStyle } from "./orgBranding";
// Renders the printable HTML for the weekly client report pack — the same KPI set as the monthly
// pack (monthlyReportTemplate.ts) but scoped to a 7-day window instead of a calendar month. Kept as
// its own template file (rather than parameterising buildMonthlyReportHtml) to match this
// codebase's existing convention of one template file per report job (see fatReportTemplate.ts /
// inspectionReportTemplate.ts / monthlyReportTemplate.ts, none of which share a base template
// either) — only the aggregation query logic (reportPackAggregation.ts) is actually shared, since
// that's the part that was genuinely generic over any date range.

import type { MonthlyReportProjectRow } from "./monthlyReportTemplate";

export interface WeeklyReportTemplateData {
  /** Organisation brand colours (co-branded / white-label only) — see orgBranding.ts. */
  branding?: { brandPrimaryColor?: string | null; brandAccentColor?: string | null };
  organizationName: string;
  weekStartIso: string; // YYYY-MM-DD, inclusive
  weekEndIso: string; // YYYY-MM-DD, inclusive (weekStart + 6 days)
  weekLabel: string; // e.g. "15 Sep 2026 - 21 Sep 2026"

  /** % of itp_items whose first inspection_record in the week passed on the first attempt. Null when there were no first attempts in the week. */
  firstTimePassRate: number | null;
  firstTimePassCounts: { firstAttempts: number; firstTimePasses: number };

  /** inspection_records with a non-null overall_result, created in the week, across all the org's projects. */
  inspectionsCompleted: number;

  /** NCRs raised and closed in the week, by severity. */
  ncrsOpenedInWeek: number;
  ncrsClosedInWeek: number;
  ncrsBySeverity: { severity: string; opened: number; closed: number }[];

  /** % of the org's ITPs (all-time, not week-scoped — an ITP's completion state is a snapshot, not
   *  something that happened "in" a week) with status = 'client_accepted'. */
  itpCompletionRate: number | null;
  itpCompletionCounts: { clientAccepted: number; total: number };

  perProject: MonthlyReportProjectRow[];

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

function renderKpiCards(data: WeeklyReportTemplateData): string {
  const cards = [
    {
      label: "FIRST-TIME PASS RATE",
      value: pct(data.firstTimePassRate),
      sub: `${data.firstTimePassCounts.firstTimePasses} / ${data.firstTimePassCounts.firstAttempts} first attempts`,
    },
    {
      label: "INSPECTIONS COMPLETED",
      value: String(data.inspectionsCompleted),
      sub: `across ${data.perProject.length} project${data.perProject.length === 1 ? "" : "s"}`,
    },
    {
      label: "ITP COMPLETION",
      value: pct(data.itpCompletionRate),
      sub: `${data.itpCompletionCounts.clientAccepted} / ${data.itpCompletionCounts.total} client-accepted (all-time)`,
    },
    {
      label: "NCRS THIS WEEK",
      value: `${data.ncrsOpenedInWeek} opened / ${data.ncrsClosedInWeek} closed`,
      sub: "see NCR summary below",
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

function renderNcrTable(rows: { severity: string; opened: number; closed: number }[]): string {
  if (rows.length === 0) {
    return `<p class="empty-note">No NCRs raised or closed this week.</p>`;
  }
  const body = rows
    .map(
      (r) => `
      <tr>
        <td>${cell(r.severity)}</td>
        <td>${cell(r.opened)}</td>
        <td>${cell(r.closed)}</td>
      </tr>`
    )
    .join("");
  return `
    <table class="data-table">
      <thead><tr><th>SEVERITY</th><th>OPENED THIS WEEK</th><th>CLOSED THIS WEEK</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function renderProjectTable(rows: MonthlyReportProjectRow[]): string {
  if (rows.length === 0) {
    return `<p class="empty-note">This organisation has no projects yet.</p>`;
  }
  const body = rows
    .map(
      (r) => `
      <tr>
        <td>${cell(r.projectNumber)}</td>
        <td>${cell(r.projectName)}</td>
        <td>${cell(r.inspectionsCompleted)}</td>
        <td>${cell(r.ncrsOpened)}</td>
        <td>${cell(r.ncrsClosed)}</td>
      </tr>`
    )
    .join("");
  return `
    <table class="data-table">
      <thead>
        <tr><th>PROJECT NO.</th><th>PROJECT</th><th>INSPECTIONS COMPLETED</th><th>NCRS OPENED</th><th>NCRS CLOSED</th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

export function buildWeeklyReportHtml(data: WeeklyReportTemplateData): string {
  const generatedAtLabel = data.generatedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.organizationName)} - Weekly Report Pack - ${escapeHtml(data.weekLabel)}</title>
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
    /* Deliberately NOT bled to the true page edge — see monthlyReportTemplate.ts's identical note. */
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
${brandColorStyle(data.branding)}
  <div class="letterhead">
    <div class="brand">
      <div class="brand-mark">JA</div>
      <div class="wordmark">JAGS Assurance<small>QUALITY MANAGEMENT &amp; INSPECTION</small></div>
    </div>
    <div class="doc-control">
      <div class="doc-control-title">DOCUMENT CONTROL</div>
      <dl class="doc-control-body">
        <dt>REPORT TYPE</dt><dd>Weekly Pack</dd>
        <dt>PERIOD</dt><dd>${escapeHtml(data.weekLabel)}</dd>
        <dt>GENERATED</dt><dd>${escapeHtml(generatedAtLabel)}</dd>
      </dl>
    </div>
  </div>

  <div class="title-block">
    <h1>Weekly Client Report Pack</h1>
    <div class="subline">${escapeHtml(data.organizationName)} &mdash; ${escapeHtml(data.weekLabel)}</div>
  </div>

  ${renderKpiCards(data)}

  <h2 class="section-title">NCR Summary (${escapeHtml(data.weekLabel)})</h2>
  ${renderNcrTable(data.ncrsBySeverity)}

  <h2 class="section-title">By Project</h2>
  ${renderProjectTable(data.perProject)}

  <div class="footer-note">
    <span>Generated by QMP Inspect &mdash; JAGS Assurance. Covers all services this organisation is licensed for.</span>
    <span>Generated ${escapeHtml(generatedAtLabel)}</span>
  </div>
</body>
</html>`;
}
