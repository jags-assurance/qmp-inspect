// Renders the printable HTML for an ITP (Inspection & Test Plan) — the controlled document JAGS
// issues to a project, prepared/reviewed/approved by JAGS staff then accepted by the client
// (Reqs R66-R81). Puppeteer renders this to landscape A4 PDF in renderItpPdf.ts; this module only
// builds the markup, so it can be eyeballed/tested without a browser.

export interface ItpTemplateParty {
  id: string;
  name: string;
  partyType: string;
}

// The raw party_type enum ("main_contractor", "tpi_lab") rendered as-is with CSS text-transform:
// capitalize used to produce "Main_contractor" / "Tpi_lab" — capitalize only affects the first
// letter of a whitespace-delimited word, and an underscore isn't a word boundary. Same label set as
// ROLE_LABEL in apps/web/app/inspect/external-party-dashboard.tsx, kept in sync by hand since the
// worker and web app don't share a lib.
const PARTY_TYPE_LABEL: Record<string, string> = {
  client: "Client",
  subcontractor: "Subcontractor",
  main_contractor: "Main Contractor",
  tpi_lab: "TPI / Lab",
  vendor: "Vendor",
  jags: "JAGS",
};

function partyTypeLabel(partyType: string): string {
  return PARTY_TYPE_LABEL[partyType] ?? partyType;
}

export interface ItpTemplateIntervention {
  itpItemId: string;
  projectPartyId: string;
  code: string;
}

/**
 * This ITP's organisation's configured intervention levels, in sort_order (supabase/migrations/
 * 20260917090000_configurable_intervention_levels.sql) — replaces the old hardcoded H/W/R/S legend
 * and per-code CSS classes, so a custom level (e.g. "Client QA Review") gets its own legend entry
 * and its own distinct swatch color in the rendered PDF, not just the picker/grid in the web app.
 */
export interface ItpTemplateLevelType {
  code: string;
  label: string;
  sortOrder: number;
  /** Whether this level blocks progress outright (Hold-equivalent) — drives the tinted cell
   *  background in the per-party grid below, matching apps/web/app/inspect/itps/[id]/
   *  activity-signoff-grid.tsx's cellToneClass. */
  isBlocking: boolean;
}

/**
 * Whether the party holding this intervention has actually acted on it yet — separate from the
 * intervention code itself (which only ever says who holds what, never whether it happened). Without
 * this, a freshly-approved ITP and a fully-executed one render an identical-looking grid.
 */
export type ItpTemplateSignoffStatus = "pending" | "notified" | "signed_off" | "proceeded_no_response";

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
  /** This ITP's discipline, derived from its items' discipline_id (master_disciplines.name).
   *  "Multi-discipline" when items span more than one, null when there are no items or none set. */
  discipline?: string | null;
  /** The source specification document this ITP's items were written against, when the ITP's items
   *  reliably agree on one (see renderItpPdf.ts) — there's no dedicated column for this, so it's
   *  best-effort and frequently null. */
  sourceSpec?: string | null;
  parties: ItpTemplateParty[];
  sections: ItpTemplateSection[];
  interventions: ItpTemplateIntervention[];
  signoffStatuses: ItpTemplateSignoffCell[];
  signoffs: ItpTemplateSignoff[];
  levelTypes: ItpTemplateLevelType[];
  generatedAt: Date;
  /**
   * Drives the letterhead/footer per the organisation's engagement_mode (Reqs R113-R118) — see
   * orgBranding.ts. Optional/undefined renders exactly as jags_led (today's unchanged branding),
   * so every existing caller keeps working without a change.
   */
  branding?: ItpTemplateBranding;
}

export interface ItpTemplateBranding {
  engagementMode: "jags_led" | "co_branded" | "white_label";
  /** Signed URL for the client org's uploaded logo, or null when there's none to show. */
  logoUrl: string | null;
}

// Swatch/text colors assigned by POSITION in the organisation's own sorted level list, not by a
// fixed code — matches apps/web/lib/intervention-levels/types.ts's TONE_PALETTE reasoning (kept in
// sync by hand, same as PARTY_TYPE_LABEL above, since the worker and web app don't share a lib). The
// first four entries are the exact original H/W/R/S colors so every existing org's PDF renders
// pixel-identical to before this feature; a 5th+ custom level cycles through the rest of the palette.
const LEVEL_COLOR_PALETTE: { background: string; color: string }[] = [
  { background: "#E5555A", color: "#fff" }, // was .intervention-H
  { background: "#F5C518", color: "#1C1C1E" }, // was .intervention-W
  { background: "#4C7EA8", color: "#fff" }, // was .intervention-R
  { background: "#9AA0A6", color: "#fff" }, // was .intervention-S
  { background: "#6B8F71", color: "#fff" },
  { background: "#8B6BAF", color: "#fff" },
];

function colorForLevelIndex(index: number): { background: string; color: string } {
  return LEVEL_COLOR_PALETTE[index % LEVEL_COLOR_PALETTE.length];
}

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
  proceeded_no_response: "Proceeded without response (notice period elapsed)",
};

// Appended to the intervention letter so a freshly-approved ITP and a fully-executed one don't
// render an identical grid: a tilde for in-progress (plain ASCII, safe in any font), nothing for
// not-yet-started (the letter alone already reads as "not started" without extra noise). Signed-off
// uses an inline SVG rather than a Unicode check mark (U+2713) — Puppeteer's default Arial/Helvetica
// fallback doesn't carry that glyph and silently renders it as a missing-character box instead.
const SIGNOFF_NOTIFIED_MARK = "~";
// Distinct from both marks above — this activity was never actually signed off, just timed out past
// its notice period (R66-R81's "proceed without response"), so it shouldn't look identical to a real
// checkmark or still read as merely "in progress" like the notified tilde.
const SIGNOFF_PROCEEDED_MARK = "››"; // "»" (double right-pointing angle quote), plain enough for the Arial/Helvetica fallback
const SIGNOFF_CHECK_SVG =
  '<svg class="signoff-check" viewBox="0 0 12 12" width="8" height="8"><polyline points="2,6.5 5,9.5 10,3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * One party's intervention token for one item — a colored chip carrying the level code, plus a
 * signoff-status mark (checkmark/tilde/none). The party itself is identified by the column header
 * (see renderSection's per-party <th>s), so the chip only needs to carry the level, not the party.
 */
function interventionToken(
  party: ItpTemplateParty,
  code: string,
  status: ItpTemplateSignoffStatus | undefined,
  levelIndexByCode: Map<string, number>,
  levelLabelByCode: Map<string, string>
): string {
  const effectiveStatus = status ?? "pending";
  const mark =
    effectiveStatus === "signed_off"
      ? SIGNOFF_CHECK_SVG
      : effectiveStatus === "notified"
        ? SIGNOFF_NOTIFIED_MARK
        : effectiveStatus === "proceeded_no_response"
          ? SIGNOFF_PROCEEDED_MARK
          : "";
  const label = levelLabelByCode.get(code) ?? code;
  const title = `${escapeHtml(party.name)} (${escapeHtml(partyTypeLabel(party.partyType))}) — ${escapeHtml(label)} — ${SIGNOFF_STATUS_LABEL[effectiveStatus]}`;
  const { background, color } = colorForLevelIndex(levelIndexByCode.get(code) ?? 0);
  return `<span class="iv-token signoff-${effectiveStatus}" style="background:${background};color:${color}" title="${title}">${escapeHtml(code)}${mark ? `<span class="signoff-mark">${mark}</span>` : ""}</span>`;
}

/**
 * One <td> per project party (matching apps/web/app/inspect/itps/[id]/activity-signoff-grid.tsx's
 * table layout — rows = activities, columns = parties, one column per project_party in the same
 * order the web grid uses). A party with no intervention on this item gets a plain, subdued em-dash
 * cell (not omitted — the column still exists, it's just empty for this row); a blocking level
 * (Hold-equivalent, per this org's own intervention_level_types.is_blocking) gets a tinted cell
 * background, same as cellToneClass on the web side.
 */
function partyInterventionCell(
  party: ItpTemplateParty,
  item: ItpTemplateItem,
  interventionByItem: Map<string, Map<string, string>>,
  statusByItem: Map<string, Map<string, ItpTemplateSignoffStatus>>,
  levelIndexByCode: Map<string, number>,
  levelLabelByCode: Map<string, string>,
  blockingCodes: Set<string>
): string {
  const code = interventionByItem.get(item.id)?.get(party.id);
  if (!code) return '<td class="party-cell intervention-none">&mdash;</td>';
  const status = statusByItem.get(item.id)?.get(party.id);
  const toneClass = blockingCodes.has(code) ? "party-cell-blocking" : "party-cell-set";
  const token = interventionToken(party, code, status, levelIndexByCode, levelLabelByCode);
  return `<td class="party-cell ${toneClass}">${token}</td>`;
}

/** Item/activity cell: item number and activity text combined per the client's sample format. */
function itemActivityCell(item: ItpTemplateItem): string {
  return `<td class="item-activity"><span class="item-number">${cell(item.itemNumber)}</span><div class="activity">${cell(item.activity)}</div></td>`;
}

/**
 * Acceptance/method cell: acceptance criteria on its own line, falling back to the literal
 * "PENDING INPUT" when unset — the client's sample explicitly shows a blocked/unconfigured
 * acceptance criterion this way rather than as a blank or em-dash cell — followed by a
 * "{method} / {frequency}" line built from whichever of the two is actually present.
 */
function acceptanceMethodCell(item: ItpTemplateItem): string {
  const hasAcceptance = Boolean(item.acceptanceCriteria && item.acceptanceCriteria.trim());
  const acceptanceHtml = hasAcceptance
    ? escapeHtml(item.acceptanceCriteria as string)
    : '<span class="pending-input">PENDING INPUT</span>';
  const methodFreqParts = [item.method, item.frequency].filter((v): v is string => Boolean(v && v.trim()));
  const methodFreqHtml = methodFreqParts.length > 0 ? `<div class="method-freq">${escapeHtml(methodFreqParts.join(" / "))}</div>` : "";
  return `<td><div class="acceptance">${acceptanceHtml}</div>${methodFreqHtml}</td>`;
}

function renderSection(
  section: ItpTemplateSection,
  parties: ItpTemplateParty[],
  interventions: ItpTemplateIntervention[],
  signoffStatuses: ItpTemplateSignoffCell[],
  levelIndexByCode: Map<string, number>,
  levelLabelByCode: Map<string, string>,
  blockingCodes: Set<string>
): string {
  const interventionByItem = new Map<string, Map<string, string>>();
  for (const iv of interventions) {
    if (!interventionByItem.has(iv.itpItemId)) interventionByItem.set(iv.itpItemId, new Map());
    interventionByItem.get(iv.itpItemId)!.set(iv.projectPartyId, iv.code);
  }

  const statusByItem = new Map<string, Map<string, ItpTemplateSignoffStatus>>();
  for (const s of signoffStatuses) {
    if (!statusByItem.has(s.itpItemId)) statusByItem.set(s.itpItemId, new Map());
    statusByItem.get(s.itpItemId)!.set(s.projectPartyId, s.status);
  }

  const partyHeaders = parties
    .map((party) => `<th class="party-header" title="${escapeHtml(party.name)}">${escapeHtml(party.name)}</th>`)
    .join("");

  const rows = section.items
    .map((item) => {
      const partyCells = parties
        .map((party) =>
          partyInterventionCell(party, item, interventionByItem, statusByItem, levelIndexByCode, levelLabelByCode, blockingCodes)
        )
        .join("");
      return `
        <tr>
          ${itemActivityCell(item)}
          <td>${cell(item.referenceSpec)}</td>
          ${acceptanceMethodCell(item)}
          ${partyCells}
        </tr>`;
    })
    .join("");

  return `
    <section class="itp-section">
      <div class="section-eyebrow">Section ${section.sectionNumber}</div>
      <h2>${escapeHtml(section.title)}</h2>
      <table class="items-table">
        <thead>
          <tr>
            <th>Item / activity</th>
            <th>Reference</th>
            <th>Acceptance / method</th>
            ${partyHeaders}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

// Built from this ITP's ORGANISATION's own configured intervention levels (sort_order), not a
// hardcoded H/W/R/S list — so a custom 5th level an admin adds shows up in the legend too, with its
// own swatch color (see colorForLevelIndex).
function renderLegend(levelTypes: ItpTemplateLevelType[]): string {
  const items = levelTypes
    .map((lt, i) => {
      const { background } = colorForLevelIndex(i);
      return `<span class="legend-item"><span class="legend-swatch" style="background:${background}"></span>${escapeHtml(lt.code)} &ndash; ${escapeHtml(lt.label)}</span>`;
    })
    .join("");
  return `
    <div class="legend">
      ${items}
      <span class="legend-item legend-signoff">${SIGNOFF_CHECK_SVG} Signed off &nbsp;&nbsp; ${SIGNOFF_NOTIFIED_MARK} Notified, awaiting sign-off &nbsp;&nbsp; ${escapeHtml(SIGNOFF_PROCEEDED_MARK)} Proceeded without response &nbsp;&nbsp; (no mark) Not yet notified</span>
    </div>`;
}

/**
 * "{itpNumber} Rev {revision} | {discipline} | source {sourceSpec}" document-identity line, matching
 * the client's sample format. discipline/sourceSpec are both optional and best-effort (see
 * ItpTemplateData), so the line is only shown once at least one of them is present, and built from
 * whichever parts actually exist — never rendering an empty "| |" gap for a missing one.
 */
function renderIdentityLine(data: ItpTemplateData): string {
  if (!data.discipline && !data.sourceSpec) return "";
  const parts: string[] = [`${escapeHtml(data.itpNumber)} Rev ${data.revision}`];
  if (data.discipline) parts.push(escapeHtml(data.discipline));
  if (data.sourceSpec) parts.push(`source ${escapeHtml(data.sourceSpec)}`);
  return `<div class="identity-line">${parts.join(" &nbsp;|&nbsp; ")}</div>`;
}

const JAGS_BRAND_BLOCK =
  '<div class="brand-mark">JA</div><div class="wordmark">JAGS ASSURANCE&nbsp;&nbsp;/&nbsp;&nbsp;QMP INSPECT</div>';

/**
 * The letterhead's brand mark, driven by engagement_mode (Reqs R113-R118 — same semantic split as
 * lib/numbering/generate.ts's internalReference for white_label): jags_led (or no branding info at
 * all, or no logo uploaded) renders exactly as before; co_branded adds the client's logo alongside
 * JAGS's own; white_label replaces JAGS's brand mark with the client's logo. A white_label org that
 * hasn't uploaded a logo yet still falls back to the JAGS-only mark — never a fabricated placeholder
 * logo standing in for a real one.
 */
function renderBrandBlock(data: ItpTemplateData): string {
  const mode = data.branding?.engagementMode ?? "jags_led";
  const logoUrl = data.branding?.logoUrl ?? null;

  if (!logoUrl) return JAGS_BRAND_BLOCK;

  const orgLogo = `<img class="org-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName)} logo" />`;

  if (mode === "white_label") return orgLogo;
  if (mode === "co_branded") return `${JAGS_BRAND_BLOCK}<img class="org-logo org-logo-co-branded" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(data.organizationName)} logo" />`;
  return JAGS_BRAND_BLOCK;
}

/** The literal R113 requirement: white_label mode keeps JAGS's own authorship visible as small
 *  print even though its logo is gone from the letterhead. Empty string in every other mode. */
function renderPoweredByFooter(data: ItpTemplateData): string {
  if ((data.branding?.engagementMode ?? "jags_led") !== "white_label") return "";
  return '<div class="powered-by">Powered by JAGS Assurance</div>';
}

function renderSignoffs(signoffs: ItpTemplateSignoff[]): string {
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

export function buildItpHtml(data: ItpTemplateData): string {
  const statusLabel = STATUS_LABEL[data.status] ?? data.status;
  const sortedLevelTypes = [...data.levelTypes].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const levelIndexByCode = new Map(sortedLevelTypes.map((lt, i) => [lt.code, i]));
  const levelLabelByCode = new Map(sortedLevelTypes.map((lt) => [lt.code, lt.label]));
  const blockingCodes = new Set(sortedLevelTypes.filter((lt) => lt.isBlocking).map((lt) => lt.code));
  const sectionsHtml = data.sections
    .map((s) =>
      renderSection(s, data.parties, data.interventions, data.signoffStatuses, levelIndexByCode, levelLabelByCode, blockingCodes)
    )
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
    border-radius: 4px;
    /* Deliberately NOT bled to the true page edge via a negative margin cancelling @page's margin —
       Chrome's print-to-PDF does not reliably apply that margin the same way twice in a row (visible
       as the logo/wordmark getting clipped on some renders and not others, with no CSS change that
       reliably fixed it), so the letterhead now sits as a normal box inside the margin, the same
       reliable box model every other section on this page already uses. */
    padding: 10px 16px;
    margin-bottom: 10px;
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

  /* Client org logo (Reqs R113-R118) — co_branded shows it alongside the JAGS wordmark above,
     white_label shows it alone in place of the wordmark (see renderBrandBlock). Height-capped, not
     width-capped, so a wide or narrow logo both sit at a consistent letterhead scale. */
  .org-logo {
    max-height: 34px;
    max-width: 160px;
    object-fit: contain;
  }

  .org-logo-co-branded {
    padding-left: 10px;
    border-left: 1px solid rgba(255, 255, 255, 0.3);
  }

  .powered-by {
    margin-top: 4px;
    font-size: 7px;
    color: #999;
    text-align: right;
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

  .identity-line {
    font-size: 9px;
    font-family: "Courier New", monospace;
    color: var(--burgundy);
    font-weight: bold;
    letter-spacing: 0.2px;
    margin-bottom: 3px;
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

  .section-eyebrow {
    font-size: 7.5px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 1px;
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
    border-bottom: 2px solid var(--gold);
  }

  table.items-table tbody tr:nth-child(even) {
    background: var(--off-white);
  }

  table.items-table tbody tr:hover {
    background: #efe9e6;
  }

  td.item-activity {
    min-width: 130px;
  }

  td.item-activity .item-number {
    display: block;
    white-space: nowrap;
    font-weight: bold;
  }

  td.item-activity .activity {
    margin-top: 1px;
  }

  .acceptance {
    margin-bottom: 2px;
  }

  .pending-input {
    display: inline-block;
    font-weight: bold;
    font-size: 7.5px;
    letter-spacing: 0.4px;
    color: var(--burgundy);
    background: #f1dede;
    border: 1px solid var(--burgundy);
    border-radius: 2px;
    padding: 1px 5px;
    text-transform: uppercase;
  }

  .method-freq {
    color: #555;
    font-style: italic;
  }

  /* One column per project party (matches activity-signoff-grid.tsx's table layout) — narrow and
     centered, since each cell holds at most one chip. */
  th.party-header {
    max-width: 70px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }

  td.party-cell {
    width: 60px;
    text-align: center;
  }

  /* Matches apps/web/app/inspect/itps/[id]/activity-signoff-grid.tsx's cellToneClass: a blocking
     level (Hold-equivalent) gets a tinted background, a non-blocking one stays plain. */
  td.party-cell-blocking {
    background: #f6e9ea;
  }

  /* Per-level background/text color is set inline per token (colorForLevelIndex), keyed by that
     level's position in the organisation's own sorted list rather than a fixed H/W/R/S class — a
     custom level gets a color this way too. */
  .iv-token {
    display: inline-flex;
    align-items: center;
    font-weight: bold;
    border-radius: 2px;
    padding: 1px 5px;
    white-space: nowrap;
  }

  .intervention-none { color: #bbb; text-align: center; }

  /* Sign-off completion, layered on top of the intervention color above: a pending token (holder
     assigned but not yet notified) is dimmed so it reads as "not started"; a notified token gets a
     dashed outline (in progress); a signed-off token stays full-strength, bold, with a check mark.
     Without this a freshly-approved ITP and a fully-executed one would render an identical grid. */
  .iv-token.signoff-pending { opacity: 0.45; }
  .iv-token.signoff-notified { outline: 1.5px dashed var(--ink); outline-offset: -1px; }
  .iv-token.signoff-signed_off { outline: 1px solid var(--ink); }
  .iv-token.signoff-proceeded_no_response { outline: 1.5px dotted var(--ink); outline-offset: -1px; }
  .signoff-mark {
    display: inline-block;
    margin-left: 2px;
    font-size: 7px;
    vertical-align: middle;
  }

  .signoff-check {
    vertical-align: -1px;
  }

  .legend-signoff .signoff-check {
    vertical-align: -1px;
    color: var(--ink);
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
      ${renderBrandBlock(data)}
    </div>
    <div class="doc-control">
      <div class="doc-control-title">DOCUMENT CONTROL</div>
      <dl class="doc-control-body">
        <dt>DOC NO.</dt><dd>${escapeHtml(data.itpNumber)}</dd>
        <dt>REVISION</dt><dd>${data.revision}</dd>
        <dt>STATUS</dt><dd>${escapeHtml(statusLabel)}</dd>
        <dt>GENERATED</dt><dd>${escapeHtml(generatedAtLabel)}</dd>
      </dl>
    </div>
  </div>

  <div class="title-block">
    ${renderIdentityLine(data)}
    <h1>${escapeHtml(data.title)}<span class="status-badge">${escapeHtml(statusLabel)}</span></h1>
    <div class="subline">${escapeHtml(data.organizationName)} &mdash; ${escapeHtml(data.projectName)} (${escapeHtml(data.projectNumber)})</div>
  </div>

  <div class="info-grid">
    <div><span class="label">SCOPE</span>${cell(data.scope)}</div>
    <div><span class="label">APPLICABLE STANDARD</span>${cell(data.applicableStandard)}</div>
    <div><span class="label">REVISION</span>${data.revision}</div>
    <div><span class="label">STATUS</span>${escapeHtml(statusLabel)}</div>
  </div>

  ${renderLegend(sortedLevelTypes)}

  ${sectionsHtml}

  <div class="signoff-block">
    <h2>Revision &amp; Approval</h2>
    ${renderSignoffs(data.signoffs)}
  </div>

  <div class="footer-note">
    <span>Generated by QMP Inspect &mdash; JAGS Assurance</span>
    <span>Generated ${escapeHtml(generatedAtLabel)}</span>
  </div>
  ${renderPoweredByFooter(data)}
</body>
</html>`;
}
