// Renders the printable HTML for a project's Data Book (R86, R108) — a branded cover page followed
// by a compiled readiness summary: every ITP/inspection-record/register/NCR/punch-list category the
// data book's completion gate checks (see apps/web/lib/databook/readiness.ts, whose category
// definitions and percentage formula this mirrors exactly — the worker can't import that file
// directly, since it depends on the Next.js server-only Supabase client, so the same computation is
// re-derived from the same tables in renderDataBookPdf.ts instead). Puppeteer renders this to
// portrait A4 PDF in renderDataBookPdf.ts; this module only builds the markup.

export interface DataBookPdfCategory {
  label: string;
  ready: number;
  total: number;
  percentage: number;
}

export interface DataBookPdfData {
  bookNumber: string;
  title: string;
  status: "draft" | "compiled" | "issued";
  projectName: string;
  projectNumber: string;
  organizationName: string | null;

  /** The gating categories, in display order (ITPs, inspection records, checklists, calibration,
   *  welder, material, NCRs) — same set readiness.ts's `isReady`/`overallPercentage` are computed
   *  from. */
  categories: DataBookPdfCategory[];
  /** Informational only, same as readiness.ts's handoverCertificate — excluded from overallPercentage. */
  handoverCertificate: DataBookPdfCategory;
  openPunchItems: number;
  overallPercentage: number;
  isReady: boolean;

  compiledAt: string | null;
  overrideReason: string | null;

  generatedAt: Date;
  /**
   * Drives the letterhead/footer per the organisation's engagement_mode (Reqs R113-R118) — see
   * orgBranding.ts. Optional/undefined renders exactly as jags_led (today's unchanged branding).
   */
  branding?: DataBookPdfBranding;
}

export interface DataBookPdfBranding {
  engagementMode: "jags_led" | "co_branded" | "white_label";
  logoUrl: string | null;
}

const STATUS_LABEL: Record<DataBookPdfData["status"], string> = {
  draft: "Draft",
  compiled: "Compiled",
  issued: "Issued",
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

function renderCategoryRow(category: DataBookPdfCategory): string {
  const toneClass = category.percentage === 100 ? "cat-ready" : category.percentage === 0 ? "cat-empty" : "cat-partial";
  return `
    <tr>
      <td>${escapeHtml(category.label)}</td>
      <td class="cat-count">${category.ready} / ${category.total}</td>
      <td class="cat-pct ${toneClass}">${category.percentage}%</td>
    </tr>`;
}

function renderCategoryTable(title: string, categories: DataBookPdfCategory[]): string {
  const rows = categories.map(renderCategoryRow).join("");
  return `
    <div class="section">
      <h2>${escapeHtml(title)}</h2>
      <table class="category-table">
        <thead>
          <tr><th>Category</th><th>Provided / Required</th><th>Complete</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

const JAGS_BRAND_BLOCK = '<div class="brand-mark">JA</div><div class="wordmark">JAGS ASSURANCE<small>QMP INSPECT</small></div>';

/** See ncrTemplate.ts's renderBrandBlock — identical semantics, duplicated rather than shared since
 *  the templates don't share a lib (same convention as elsewhere in this file). */
function renderBrandBlock(data: DataBookPdfData): string {
  const mode = data.branding?.engagementMode ?? "jags_led";
  const logoUrl = data.branding?.logoUrl ?? null;
  if (!logoUrl) return JAGS_BRAND_BLOCK;

  const orgLogo = `<img class="org-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  if (mode === "white_label") return orgLogo;
  if (mode === "co_branded") return `${JAGS_BRAND_BLOCK}<img class="org-logo org-logo-co-branded" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName || "Client")} logo" />`;
  return JAGS_BRAND_BLOCK;
}

/** The literal R113 requirement — small print in white_label mode only. */
function renderPoweredByFooter(data: DataBookPdfData): string {
  if ((data.branding?.engagementMode ?? "jags_led") !== "white_label") return "";
  return '<div class="powered-by">Powered by JAGS Assurance</div>';
}

export function buildDataBookPdfHtml(data: DataBookPdfData): string {
  const generatedAtLabel = data.generatedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const statusLabel = STATUS_LABEL[data.status];
  const readinessLabel = data.isReady ? "READY FOR HANDOVER" : "NOT YET READY";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.bookNumber)}</title>
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

  /* Cover page: its own page, everything below flows onto the summary page(s) that follow. */
  .cover { page-break-after: always; padding-top: 60mm; text-align: center; }
  .cover .cover-title { font-size: 26px; font-weight: bold; color: var(--burgundy); margin: 0 0 4px 0; }
  .cover .cover-subtitle { font-size: 13px; color: #666; margin: 0 0 30px 0; }
  .cover .cover-book-number { font-family: "Courier New", monospace; font-size: 16px; font-weight: bold; margin-bottom: 6px; }
  .cover .cover-project { font-size: 14px; color: var(--ink); margin-bottom: 3px; }
  .cover .cover-org { font-size: 11px; color: #666; }
  .cover .cover-status { display: inline-block; margin-top: 26px; padding: 5px 16px; border-radius: 3px; font-size: 11px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; }
  .cover .cover-status.status-issued { background: var(--success); color: #fff; }
  .cover .cover-status.status-compiled { background: var(--gold); color: var(--ink); }
  .cover .cover-status.status-draft { background: #ddd; color: #444; }

  h1 { margin: 4px 0 10px 0; font-size: 18px; color: var(--ink); }

  .readiness-banner {
    display: flex; flex-direction: column; gap: 3px; margin-bottom: 14px;
    border: 1px solid var(--gold); border-left: 5px solid var(--burgundy);
    background: var(--off-white); border-radius: 3px; padding: 8px 12px; font-size: 11px;
  }
  .readiness-banner strong { font-size: 13px; letter-spacing: 0.2px; }
  .readiness-banner.ready strong { color: var(--success); }
  .readiness-banner.not-ready strong { color: var(--danger); }

  .section { margin-bottom: 16px; break-inside: avoid; }
  .section h2 {
    font-size: 12px; color: var(--burgundy); border-bottom: 1px solid var(--burgundy);
    padding-bottom: 3px; margin: 0 0 6px 0;
  }

  table.category-table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  table.category-table th, table.category-table td {
    border: 1px solid #ccc; padding: 5px 8px; text-align: left; vertical-align: top;
  }
  table.category-table th {
    background: var(--burgundy); color: var(--off-white); font-weight: bold; font-size: 8px;
    text-transform: uppercase; border-bottom: 2px solid var(--gold);
  }
  table.category-table tbody tr:nth-child(even) { background: var(--off-white); }
  td.cat-count { white-space: nowrap; }
  td.cat-pct { font-weight: bold; text-align: right; white-space: nowrap; }
  td.cat-pct.cat-ready { color: var(--success); }
  td.cat-pct.cat-partial { color: #b8860b; }
  td.cat-pct.cat-empty { color: var(--danger); }

  .overall-stat-bar {
    display: flex; align-items: center; gap: 18px; margin-bottom: 14px;
    border: 1px solid #e2dcd6; padding: 8px 12px; border-radius: 3px;
  }
  .overall-stat { font-size: 10px; color: #444; }
  .overall-stat b { display: block; font-size: 16px; color: var(--ink); }

  .footer-note {
    margin-top: 16px; padding-top: 6px; border-top: 1px solid #ccc;
    font-size: 7.5px; color: #666; display: flex; justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="cover">
    <div class="cover-title">Project Data Book</div>
    <p class="cover-subtitle">${escapeHtml(data.title)}</p>
    <p class="cover-book-number">${escapeHtml(data.bookNumber)}</p>
    <p class="cover-project">${escapeHtml(data.projectNumber)} &middot; ${escapeHtml(data.projectName)}</p>
    ${data.organizationName ? `<p class="cover-org">${escapeHtml(data.organizationName)}</p>` : ""}
    <div class="cover-status status-${data.status}">${escapeHtml(statusLabel)}</div>
  </div>

  <div class="letterhead">
    <div class="brand">
      ${renderBrandBlock(data)}
    </div>
    <div class="doc-control">
      <div class="doc-control-title">DOCUMENT CONTROL</div>
      <dl class="doc-control-body">
        <dt>DOC NO.</dt><dd>${escapeHtml(data.bookNumber)}</dd>
        <dt>REV</dt><dd>0</dd>
        <dt>GENERATED</dt><dd>${escapeHtml(generatedAtLabel)}</dd>
      </dl>
    </div>
  </div>

  <h1>Compiled Summary</h1>

  <div class="readiness-banner ${data.isReady ? "ready" : "not-ready"}">
    <strong>${escapeHtml(readinessLabel)}</strong>
    <span>${
      data.isReady
        ? "Every gating category is complete and there are no open punch-list items."
        : "One or more gating categories are incomplete, or open punch-list items remain."
    }</span>
  </div>

  <div class="overall-stat-bar">
    <div class="overall-stat"><b>${data.overallPercentage}%</b>Overall completion</div>
    <div class="overall-stat"><b>${data.openPunchItems}</b>Open punch-list items</div>
    <div class="overall-stat"><b>${cell(data.compiledAt)}</b>Compiled</div>
  </div>

  ${data.overrideReason ? `<div class="section"><h2>Conditional handover</h2><p>${escapeHtml(data.overrideReason)}</p></div>` : ""}

  ${renderCategoryTable("Readiness by category", data.categories)}

  ${renderCategoryTable("Handover", [data.handoverCertificate])}

  <div class="footer-note">
    <span>Doc No. ${escapeHtml(data.bookNumber)} &middot; Uncontrolled when printed &middot; jagsassurance.com</span>
    <span>Generated ${escapeHtml(generatedAtLabel)}</span>
  </div>
  ${renderPoweredByFooter(data)}
</body>
</html>`;
}
