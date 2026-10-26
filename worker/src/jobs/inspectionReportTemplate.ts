// Renders the printable HTML for a general Inspection Report (R63-R65, R108) — the branded A4
// document a client receives for a single completed inspection, distinct from the small IRN
// certificate (which only confirms pass/release). Puppeteer renders this to portrait A4 PDF in
// renderInspectionReportPdf.ts; this module only builds the markup.

import type { InspectionReportLinkedDocument } from "./linkedDocuments";

export interface InspectionReportResult {
  itemNumber: string;
  description: string;
  result: "yes" | "no" | "na";
  comment: string | null;
}

export interface InspectionReportPhoto {
  caption: string | null;
  /** The checklist item this photo is proof for ("Item 2 — …"); null/absent = the inspection as a whole. */
  itemLabel?: string | null;
  /** Already-fetched image bytes as a data: URI — the worker downloads from Storage and inlines
   *  it, so the PDF is a self-contained, permanent record with no dependency on a signed URL. */
  dataUri: string;
}

export interface InspectionReportApproval {
  label: string;
  /** Party organisation name. */
  org: string | null;
  name: string | null;
  /** Data URL (drawn signature) or plain text. */
  signature: string | null;
  date: string | null;
}

export interface VerifiedInstrument { name: string; tag: string | null; cert: string | null; due: string | null }
export interface VerifiedMaterial { description: string; heat: string | null; batch: string | null; cert: string | null }
export interface VerifiedWelder { id: string; wpq: string | null; expiry: string | null }

export interface InspectionReportData {
  /** Signing details (inspection_records.signed_by_name / signed_at / witness_*). */
  signedByName?: string | null;
  signedAt?: Date | null;
  witnessName?: string | null;
  /** Data URL (drawn signature) or plain text. */
  witnessSignature?: string | null;
  instruments?: VerifiedInstrument[];
  materials?: VerifiedMaterial[];
  welders?: VerifiedWelder[];
  recordNumber: string;
  /** Attempt count for this activity (0-indexed) — drives the Document Control "REV" cell, same
   *  idea as the ITP PDF's own `itps.revision`, scoped to re-inspections of this one activity. */
  revision: number | string;
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
  /** R64/R103/R125 frozen traceability header fields — read directly off inspection_records
   *  (never live-joined), so the PDF reflects exactly what was in force at inspection time even if
   *  the source project/ITP/drawing has since changed. All optional/best-effort. */
  clientName?: string | null;
  applicableStandard?: string | null;
  governingDrawingReference?: string | null;
  governingDrawingRevision?: string | null;
  /** IRN number already issued against this inspection record, if any — drives the FIELD RESULT
   *  banner's hold-release wording. Null/undefined means no IRN has been issued yet. */
  irnNumber?: string | null;
  results: InspectionReportResult[];
  /** Vault documents linked to individual checklist items (name, status, link/reference). */
  linkedDocuments?: InspectionReportLinkedDocument[];
  photos: InspectionReportPhoto[];
  /** Photos that exist on the record but are NOT in this report (too large / over the cap / unreadable). */
  skippedPhotos?: string[];
  approvals: InspectionReportApproval[];
  inspectorName?: string | null;
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
  /** Org-configured accent colors (organizations.brand_primary_color/brand_accent_color), only ever
   *  set outside jags_led mode (see orgBranding.ts) — overrides the --burgundy/--gold CSS variables
   *  below when present. A real gap found live: this template previously always rendered in JAGS's
   *  fixed burgundy/gold regardless of the org's own configured branding colors. */
  brandPrimaryColor?: string | null;
  brandAccentColor?: string | null;
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

/** Narrow hex-color validation (`#abc` or `#aabbcc`) — the only shape the branding color picker
 *  ever saves, but never trust a DB value directly into a raw CSS block without checking it still
 *  looks like a color. */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/** Overrides the --burgundy/--gold CSS variables with the org's own configured colors, when set —
 *  see InspectionReportBranding's doc comment for why this previously never happened. Emits nothing
 *  (falls back to the default palette) when neither color is a valid hex value. */
function renderBrandColorOverride(data: InspectionReportData): string {
  const primary = data.branding?.brandPrimaryColor;
  const accent = data.branding?.brandAccentColor;
  const declarations = [
    primary && HEX_COLOR_PATTERN.test(primary) ? `--burgundy: ${primary};` : "",
    accent && HEX_COLOR_PATTERN.test(accent) ? `--gold: ${accent};` : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (!declarations) return "";
  return `<style>:root { ${declarations} }</style>`;
}

/** A factual, template-built summary from the record's own real data — not AI-generated, so it
 *  never states anything the record doesn't actually show. */
function buildConclusion(data: InspectionReportData): string {
  const resultLabel = data.overallResult === "pass" ? "PASS" : data.overallResult === "fail" ? "FAIL" : "PARTIAL";
  const scope = data.activity;
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
/** Shows coordinates only: extracts the LAST decimal lat/long pair; otherwise returns the value as is. */
export function formatLocation(loc: string | null | undefined): string | null {
  if (!loc) return null;
  const re = /(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(loc))) last = m;
  return last ? `Lat ${last[1]}, Long ${last[2]}` : loc;
}

/** Single "Inspection details" table — each fact appears exactly once. */
function renderTraceabilityTable(data: InspectionReportData): string {
  const governingDrawing = data.governingDrawingReference
    ? `${data.governingDrawingReference}${data.governingDrawingRevision ? ` (Rev ${data.governingDrawingRevision})` : ""}`
    : null;
  const drawingSpec = [governingDrawing, data.referenceSpec ?? null].filter(Boolean).join(" / ") || null;

  const rows: [string, string | null][] = [
    ["Client", data.clientName ?? null],
    ["Project", data.projectName],
    ["ITP / procedure", data.itpNumber],
    ["Activity", data.activity],
    ["Discipline", data.discipline],
    ["Location", formatLocation(data.location)],
    ["Applicable standard", data.applicableStandard ?? null],
    ["Drawing / specification", drawingSpec],
    // The inspection date is printed once, as the Document Control ISSUE DATE (not repeated here).
    ["Field Engineer", data.inspectorName ?? null],
  ].filter(([, value]) => Boolean(value)) as [string, string | null][];

  const rowsHtml = rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${cell(value)}</td></tr>`)
    .join("");

  return `
    <h2 class="details-title">Inspection details</h2>
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

function renderVerifiedAgainst(data: InspectionReportData): string {
  const inst = data.instruments ?? [];
  const mats = data.materials ?? [];
  const wel = data.welders ?? [];
  if (inst.length + mats.length + wel.length === 0) return "";
  const table = (title: string, heads: string[], rows: (string | null)[][]): string =>
    rows.length === 0
      ? ""
      : `<h3 class="va-title">${escapeHtml(title)}</h3><table class="items-table"><thead><tr>${heads.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`;
  return `
    <div class="section">
      <h2>Verified against</h2>
      ${table("Instruments", ["Instrument", "Tag", "Certificate", "Calibration due"], inst.map((i) => [i.name, i.tag, i.cert, i.due]))}
      ${table("Materials", ["Description", "Heat no.", "Batch no.", "Certificate"], mats.map((m) => [m.description, m.heat, m.batch, m.cert]))}
      ${table("Welders", ["Welder ID", "WPQ", "Qualification expiry"], wel.map((w) => [w.id, w.wpq, w.expiry]))}
    </div>`;
}

/** Documents linked to individual checklist items: item, name, vault status and link/reference. */
export function renderLinkedDocuments(docs: InspectionReportLinkedDocument[] | undefined): string {
  if (!docs || docs.length === 0) return "";
  const rows = docs
    .map((d) => {
      const name = d.url && /^https?:\/\//i.test(d.url) ? `<a href="${escapeHtml(d.url)}">${escapeHtml(d.title)}</a>` : escapeHtml(d.title);
      return `<tr><td class="item-number">${cell(d.itemNumber)}</td><td>${name}</td><td>${cell(d.statusLabel)}</td><td>${cell(d.reference)}</td></tr>`;
    })
    .join("");
  return `
    <div class="section">
      <h2>Linked documents</h2>
      <table class="items-table">
        <thead><tr><th>Item</th><th>Document</th><th>Status</th><th>Reference</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderStatusBanner(data: InspectionReportData): string {
  if (data.overallResult) return "";
  return '<div class="draft-banner">DRAFT &mdash; inspection not completed</div><div class="draft-watermark">DRAFT</div>';
}

function renderSigning(data: InspectionReportData): string {
  const rows: string[] = [];
  if (data.signedByName || data.signedAt) {
    const when = data.signedAt ? data.signedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC" : null;
    rows.push(`<tr><th>Signed by</th><td>${cell(data.signedByName)}</td></tr><tr><th>Signed at</th><td>${cell(when)}</td></tr>`);
  }
  if (data.witnessName || data.witnessSignature) {
    const sig = data.witnessSignature
      ? data.witnessSignature.startsWith("data:image/")
        ? `<img class="witness-sig" src="${escapeHtml(data.witnessSignature)}" alt="Witness signature" />`
        : escapeHtml(data.witnessSignature)
      : "&mdash;";
    rows.push(`<tr><th>Witness</th><td>${cell(data.witnessName)}</td></tr><tr><th>Witness signature</th><td>${sig}</td></tr>`);
  }
  if (rows.length === 0) return "";
  return `<table class="traceability-table"><tbody>${rows.join("")}</tbody></table>`;
}

function renderPhotos(photos: InspectionReportPhoto[], skipped: string[] = []): string {
  if (photos.length === 0 && skipped.length === 0) return "";
  const skippedNote = skipped.length
    ? `<p class="note">${skipped.length} photo(s) are recorded on this inspection but are not shown here (too large, over the per-report limit, or unreadable): ${escapeHtml(skipped.slice(0, 20).join("; "))}${skipped.length > 20 ? "; ..." : ""}. They remain in the inspection record.</p>`
    : "";
  const tiles = photos
    .map(
      (p, i) => `
        <figure class="photo-tile">
          <img src="${p.dataUri}" alt="Evidence photo ${i + 1}" />
          <figcaption>${p.itemLabel ? `<b>${escapeHtml(p.itemLabel)}</b>` : "<b>Whole inspection</b>"}${p.caption ? `<br />${escapeHtml(p.caption)}` : ""}</figcaption>
        </figure>`
    )
    .join("");
  return `
    <div class="section">
      <h2>Evidence Photos</h2>
      <div class="photo-grid">${tiles}</div>
      ${skippedNote}
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

function renderSignoffs(approvals: InspectionReportApproval[]): string {
  const cards = approvals
    .map((a) => {
      const sig = a.signature
        ? a.signature.startsWith("data:image/")
          ? `<img class="witness-sig" src="${escapeHtml(a.signature)}" alt="Signature" />`
          : `<span>${escapeHtml(a.signature)}</span>`
        : "";
      return `
        <div class="signoff-card">
          <div class="signoff-card-label">${escapeHtml(a.label)}</div>
          <div class="signoff-card-org">${a.org ? escapeHtml(a.org) : "&nbsp;"}</div>
          <div class="signoff-row"><span class="label">Name</span><span class="val">${a.name ? escapeHtml(a.name) : ""}</span></div>
          <div class="signoff-row sig"><span class="label">Signature</span><span class="val">${sig}</span></div>
          <div class="signoff-row"><span class="label">Date</span><span class="val">${a.date ? escapeHtml(a.date) : ""}</span></div>
        </div>`;
    })
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
    /* Was a 4px band — real feedback: too much decorative color weight/print ink for a line that
       carries no information. A thin 2px accent still reads as a letterhead rule without the bulk. */
    border-bottom: 2px solid var(--gold);
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

  .section { margin-bottom: 10px; }
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
    border: 1px solid #e2dcd6; padding: 3px 8px; text-align: left; vertical-align: top;
  }
  table.traceability-table th {
    width: 170px; background: var(--off-white); color: #666; font-size: 8px; font-weight: bold;
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

  .signatures-section { break-inside: avoid; page-break-inside: avoid; }
  .signatures-section h2 { break-after: avoid; page-break-after: avoid; }
  h2.details-title { font-size: 12px; color: var(--burgundy); border-bottom: 1px solid var(--burgundy); padding-bottom: 3px; margin: 0 0 6px 0; }
  .signoff-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .signoff-card-org { font-size: 8px; color: #666; margin-bottom: 4px; min-height: 10px; }
  .signoff-row { display: flex; align-items: flex-end; gap: 6px; border-bottom: 1px solid #999; min-height: 16px; margin-top: 4px; font-size: 9px; }
  .signoff-row.sig { min-height: 28px; }
  .signoff-row .label { color: #888; text-transform: uppercase; font-size: 7px; width: 38px; flex-shrink: 0; }
  .signoff-row .val { font-weight: bold; }
  .signoff-card {
    break-inside: avoid; page-break-inside: avoid; min-width: 0; border: 1px solid #ccc; border-top: 3px solid var(--burgundy);
    border-radius: 2px; padding: 6px 8px 8px 8px; background: #fff;
  }
  .signoff-card-label { font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px; color: var(--burgundy); margin-bottom: 10px; }
  .signoff-card-name { font-size: 10px; font-weight: bold; min-height: 12px; }
  .signoff-card-line { border-bottom: 1px solid #999; margin: 14px 0 4px 0; }
  .signoff-card-date { font-size: 8px; color: #444; }
  .signoff-card-date span.label { color: #888; text-transform: uppercase; font-size: 7px; margin-right: 4px; }

  .draft-banner { background: var(--danger); color: #fff; font-weight: bold; font-size: 14px; text-align: center; padding: 8px; margin-bottom: 10px; border-radius: 3px; letter-spacing: 1px; }
  .draft-watermark { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 120px; font-weight: bold; color: rgba(179, 38, 30, 0.12); transform: rotate(-30deg); z-index: 0; pointer-events: none; }
  h3.va-title { font-size: 10px; margin: 8px 0 4px 0; color: #444; }
  .witness-sig { max-height: 50px; max-width: 220px; display: block; }

  .footer-note {
    margin-top: 8px; padding-top: 6px; break-inside: avoid; border-top: 1px solid #ccc;
    font-size: 7.5px; color: #666; display: flex; justify-content: space-between;
  }
</style>
${renderBrandColorOverride(data)}
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
        <dt>REV</dt><dd>Rev ${escapeHtml(String(data.revision ?? 0))}</dd>
        <dt>ISSUE DATE</dt><dd>${escapeHtml(data.inspectionDate || "—")}</dd>
        <dt>STATUS</dt><dd>${data.overallResult ? "Final" : "Draft"}</dd>
      </dl>
    </div>
  </div>

  ${renderStatusBanner(data)}
  <h1>Inspection Report</h1>

  ${renderTraceabilityTable(data)}

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

  ${renderVerifiedAgainst(data)}

  ${renderLinkedDocuments(data.linkedDocuments)}

  ${renderPhotos(data.photos, data.skippedPhotos)}

  ${buildFieldResultBanner(data)}

  <div class="section">
    <h2>Conclusion</h2>
    <p class="conclusion">${escapeHtml(data.narrative || buildConclusion(data))}</p>
  </div>

  ${data.notes ? `<div class="section"><h2>Notes</h2><p class="conclusion">${escapeHtml(data.notes)}</p></div>` : ""}

  <div class="section signatures-section">
    <h2>Signatures</h2>
    ${renderSignoffs(data.approvals)}
  </div>

  <div class="footer-note">
    <span>Doc No. ${escapeHtml(data.recordNumber)} &middot; Uncontrolled when printed &middot; jagsassurance.com</span>
    <span>Generated ${escapeHtml(generatedAtLabel)}</span>
  </div>
  ${renderPoweredByFooter(data)}
</body>
</html>`;
}
