// Printable HTML for a project's audit-trail export: a landscape A4 table of audit_log events.
// Puppeteer renders this in renderAuditTrailPdf.ts; this module only builds the markup. Same
// letterhead conventions as ncrCloseoutTemplate.ts / irnTemplate.ts, minus the document-control
// block (an export is a record of the trail, not a controlled, revisioned document).

import { brandColorStyle } from "./orgBranding";
import { JAGS_LOGO_IMG } from "./jagsLogo";

export interface AuditTrailPdfRow {
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
  entityType: string;
  action: string;
  summary: string;
}

export interface AuditTrailPdfData {
  projectName: string;
  organizationName: string | null;
  /** Human description of the filters that were applied. */
  filterDescription: string;
  rows: AuditTrailPdfRow[];
  /** True when more events matched than are listed (the PDF row cap was hit). */
  truncated: boolean;
  rowCap: number;
  exportedByName: string | null;
  generatedAt: Date;
  branding?: {
    engagementMode: "jags_led" | "co_branded" | "white_label";
    logoUrl: string | null;
    brandPrimaryColor?: string | null;
    brandAccentColor?: string | null;
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function humanize(v: string): string {
  const t = v.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** `YYYY-MM-DD HH:mm:ss` in UTC; the raw text when it does not parse. */
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace("T", " ").slice(0, 19);
}

export function renderAuditRowHtml(r: AuditTrailPdfRow): string {
  const actor = r.actorName ? `${escapeHtml(r.actorName)}${r.actorEmail ? `<div class="muted">${escapeHtml(r.actorEmail)}</div>` : ""}` : '<span class="muted">System</span>';
  return `<tr><td class="nowrap">${escapeHtml(formatUtc(r.createdAt))}</td><td>${actor}</td><td>${escapeHtml(humanize(r.entityType))}</td><td>${escapeHtml(humanize(r.action))}</td><td>${escapeHtml(r.summary)}</td></tr>`;
}

const JAGS_BRAND_BLOCK = `${JAGS_LOGO_IMG}<div class="wordmark"><small>QMP INSPECT</small></div>`;

function renderBrandBlock(data: AuditTrailPdfData): string {
  const mode = data.branding?.engagementMode ?? "jags_led";
  const logoUrl = data.branding?.logoUrl ?? null;
  if (!logoUrl) return JAGS_BRAND_BLOCK;
  const orgLogo = `<img class="org-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  if (mode === "white_label") return orgLogo;
  if (mode === "co_branded") return `${JAGS_BRAND_BLOCK}<img class="org-logo org-logo-co-branded" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  return JAGS_BRAND_BLOCK;
}

export function buildAuditTrailPdfHtml(data: AuditTrailPdfData): string {
  const generatedAtLabel = data.generatedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const projectSubline = [data.organizationName, data.projectName].filter(Boolean).join(" · ");
  const body = data.rows.length
    ? data.rows.map(renderAuditRowHtml).join("")
    : '<tr><td colspan="5" class="muted">No audit events match these filters.</td></tr>';
  const truncatedNote = data.truncated
    ? `<div class="truncated"><strong>Incomplete listing.</strong> More events matched than fit in this PDF; only the most recent ${data.rowCap} are shown. Use the CSV export for the full trail.</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Audit trail — ${escapeHtml(data.projectName)}</title>
<style>
  @page { size: A4 landscape; margin: 15mm; }
  :root { --burgundy: #6B1E2C; --gold: #F5C518; --off-white: #F9F7F4; --ink: #1C1C1E; --danger: #b3261e; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: var(--ink); background: #fff; font-size: 9px; }
  .letterhead { display: flex; justify-content: space-between; align-items: center; gap: 14px; background: var(--burgundy); border-bottom: 2px solid var(--gold); border-radius: 4px; padding: 10px 16px; margin-bottom: 10px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand-mark { width: 30px; height: 30px; border-radius: 50%; background: var(--gold); color: var(--burgundy); font-weight: bold; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .wordmark { font-size: 16px; font-weight: bold; color: #fff; letter-spacing: 0.5px; }
  .wordmark small { display: block; font-size: 8px; font-weight: normal; color: var(--gold); letter-spacing: 1.5px; text-transform: uppercase; }
  .org-logo { max-height: 34px; max-width: 160px; object-fit: contain; }
  .org-logo-co-branded { padding-left: 10px; border-left: 1px solid rgba(255, 255, 255, 0.3); }
  .lh-title { color: #fff; font-size: 13px; font-weight: bold; letter-spacing: 0.4px; text-transform: uppercase; }
  h1 { margin: 4px 0 2px 0; font-size: 16px; }
  .subline { margin: 0 0 4px 0; font-size: 10px; color: #666; }
  .meta { margin: 0 0 8px 0; font-size: 9px; color: #444; }
  .truncated { margin: 0 0 8px 0; padding: 6px 10px; border: 1px solid var(--danger); border-left: 5px solid var(--danger); background: var(--off-white); font-size: 9.5px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { text-align: left; background: var(--off-white); color: var(--burgundy); font-size: 8px; text-transform: uppercase; letter-spacing: 0.3px; border: 1px solid #ccc; padding: 4px 6px; }
  td { border: 1px solid #ddd; padding: 4px 6px; vertical-align: top; word-break: break-word; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .nowrap { white-space: nowrap; }
  .muted { color: #777; font-size: 8px; }
</style>
</head>
<body>
${brandColorStyle(data.branding)}
  <div class="letterhead">
    <div class="brand">${renderBrandBlock(data)}</div>
    <div class="lh-title">Audit trail export</div>
  </div>
  <h1>${escapeHtml(data.projectName)}</h1>
  <p class="subline">${escapeHtml(projectSubline)}</p>
  <p class="meta">Filters: ${escapeHtml(data.filterDescription)} · ${data.rows.length} event${data.rows.length === 1 ? "" : "s"} listed (newest first, times in UTC) · Exported ${escapeHtml(generatedAtLabel)}${data.exportedByName ? ` by ${escapeHtml(data.exportedByName)}` : ""}</p>
  ${truncatedNote}
  <table>
    <thead><tr><th>Timestamp (UTC)</th><th>Actor</th><th>Record</th><th>Action</th><th>Summary</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;
}
