import { brandColorStyle } from "./orgBranding";
import { verifyBlockHtml } from "./verification";
import { JAGS_LOGO_IMG } from "./jagsLogo";
// Printable HTML for the Handover Certificate — the one-page A4 record that a Data Book was issued
// for handover, who issued it, the SHA-256 of the certified package, whether it was a conditional
// handover, and (when it exists) the client's formal acknowledgement. Rendered to PDF by
// renderHandoverCertificatePdf.ts; this module only builds the markup.

export interface HandoverCertificatePdfData {
  certificateNumber: string;
  issuedDate: string;
  issuedByName: string | null;
  bookNumber: string;
  bookTitle: string;
  bookRevision: string | null;
  projectName: string;
  organizationName: string | null;
  packageSha256: string | null;
  isConditional: boolean;
  conditionalReason: string | null;
  conditionalOpenItems: { description: string; location?: string | null; responsible_party_name?: string | null; due_date?: string | null }[];
  acknowledgedAt: string | null;
  receivedByName: string | null;
  receivedByCompany: string | null;
  acknowledgedOnBehalf: boolean;
  /** Signature drawn on the acknowledgement pad (PNG/JPEG data URL; S7-18). Anything else is ignored. */
  acknowledgementSignatureDataUri?: string | null;
  /** File name of the supporting evidence attached to the acknowledgement, if any. */
  acknowledgementEvidenceName?: string | null;
  /** Vault revision this render is filed as, so the printed REV matches the vault. */
  revision: string | null;
  /** QR code (data URI) + target URL of the public verification page; omitted when unavailable. */
  verifyQrDataUri?: string | null;
  verifyUrl?: string | null;
  generatedAt: Date;
  branding?: { engagementMode: "jags_led" | "co_branded" | "white_label"; logoUrl: string | null; brandPrimaryColor?: string | null; brandAccentColor?: string | null };
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const cell = (v: string | null | undefined): string => (v ? esc(v) : "&mdash;");

const JAGS_BRAND_BLOCK = `${JAGS_LOGO_IMG}<div class="wordmark"><small>QMP INSPECT</small></div>`;

function brandBlock(d: HandoverCertificatePdfData): string {
  const mode = d.branding?.engagementMode ?? "jags_led";
  const logo = d.branding?.logoUrl ?? null;
  if (!logo) return JAGS_BRAND_BLOCK;
  const img = `<img class="org-logo" src="${esc(logo)}" alt="${esc(d.organizationName || "Client")} logo" />`;
  if (mode === "white_label") return img;
  if (mode === "co_branded") return `${JAGS_BRAND_BLOCK}${img}`;
  return JAGS_BRAND_BLOCK;
}

/** Only a bounded base64 PNG/JPEG data URL is ever embedded as an image (same rule the database enforces). */
export function safeSignatureDataUri(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value) && value.length <= 700_000 ? value : null;
}

function fieldTable(title: string, rows: [string, string | null][], afterTableHtml = ""): string {
  return `<div class="section"><h2>${esc(title)}</h2><table class="fv"><tbody>${rows
    .map(([l, v]) => `<tr><th>${esc(l)}</th><td>${cell(v)}</td></tr>`)
    .join("")}</tbody></table>${afterTableHtml}</div>`;
}

export function buildHandoverCertificateHtml(d: HandoverCertificatePdfData): string {
  const generatedAt = d.generatedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const sub = [d.organizationName, d.projectName].filter(Boolean).join(" · ");
  const status = d.isConditional ? "CONDITIONAL HANDOVER" : "HANDOVER ISSUED";

  const conditional = d.isConditional
    ? `<div class="section"><h2>Conditions of this handover</h2>
        <p class="note">${cell(d.conditionalReason)}</p>
        ${
          d.conditionalOpenItems.length
            ? `<table class="fv"><thead><tr><th>Open item</th><th>Responsible</th><th>Agreed due</th></tr></thead><tbody>${d.conditionalOpenItems
                .map(
                  (i) =>
                    `<tr><td>${esc(i.description)}${i.location ? ` (${esc(i.location)})` : ""}</td><td>${cell(i.responsible_party_name ?? "unassigned")}</td><td>${cell(i.due_date)}</td></tr>`
                )
                .join("")}</tbody></table>`
            : ""
        }</div>`
    : "";

  const signature = safeSignatureDataUri(d.acknowledgementSignatureDataUri);
  const ack = d.acknowledgedAt
    ? fieldTable("Client acknowledgement", [
        ["Received by", d.receivedByName],
        ["Company", d.receivedByCompany],
        ["Acknowledged at", d.acknowledgedAt.replace("T", " ").slice(0, 19) + " UTC"],
        ["Recorded", d.acknowledgedOnBehalf ? "By JAGS staff on behalf of the client" : "By the client"],
        ...(d.acknowledgementEvidenceName ? ([["Supporting file", d.acknowledgementEvidenceName]] as [string, string | null][]) : []),
      ], signature ? `<div class="signature"><span class="sig-label">Signature</span><img src="${signature}" alt="Client signature" /></div>` : "")
    : `<div class="section"><h2>Client acknowledgement</h2><p class="note">Awaiting the client's formal acknowledgement of receipt.</p></div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>${esc(d.certificateNumber)}</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }
  :root { --burgundy: #6B1E2C; --gold: #F5C518; --ink: #1C1C1E; --danger: #b3261e; --success: #1f7a4d; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: var(--ink); font-size: 11px; margin: 0; }
  .letterhead { display: flex; align-items: center; gap: 12px; background: var(--burgundy); padding: 12px 16px; border-bottom: 3px solid var(--gold); }
  .brand-mark { width: 34px; height: 34px; border-radius: 50%; border: 2px solid var(--gold); color: #fff; font-weight: bold; display: flex; align-items: center; justify-content: center; font-size: 13px; }
  .wordmark { font-size: 16px; font-weight: bold; color: #fff; letter-spacing: 0.5px; }
  .wordmark small { display: block; font-size: 8px; color: var(--gold); letter-spacing: 1.5px; }
  .org-logo { max-height: 34px; max-width: 160px; object-fit: contain; }
  .title { margin: 18px 0 4px; text-align: center; font-size: 20px; color: var(--burgundy); letter-spacing: 1px; }
  .subline { text-align: center; color: #555; margin-bottom: 14px; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 3px; font-weight: bold; letter-spacing: 1px; color: #fff; background: ${d.isConditional ? "#b26b00" : "var(--success)"}; }
  .center { text-align: center; margin-bottom: 14px; }
  .section { margin-top: 14px; page-break-inside: avoid; }
  h2 { font-size: 11px; margin: 0 0 6px; padding-bottom: 3px; border-bottom: 1px solid var(--burgundy); color: var(--burgundy); text-transform: uppercase; letter-spacing: 0.8px; }
  table.fv { width: 100%; border-collapse: collapse; }
  table.fv th, table.fv td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; vertical-align: top; }
  table.fv tbody th { width: 32%; background: #f6f1ee; font-weight: 600; }
  table.fv thead th { background: #f6f1ee; }
  .signature { margin-top: 8px; display: flex; align-items: center; gap: 10px; }
  .signature .sig-label { font-size: 11px; color: #555; }
  .signature img { max-height: 70px; max-width: 260px; border-bottom: 1px solid #999; }
  .note { margin: 0; padding: 8px; background: #faf6f2; border-left: 3px solid var(--gold); }
  .hash { font-family: "Courier New", monospace; font-size: 9px; word-break: break-all; }
  .powered-by { margin-top: 18px; text-align: center; font-size: 8px; color: #777; }
</style></head>
<body>
${brandColorStyle(d.branding)}
<div class="letterhead">${brandBlock(d)}</div>
<div class="title">HANDOVER CERTIFICATE</div>
<div class="subline">${esc(sub)}</div>
<div class="center"><span class="badge">${status}</span></div>
${fieldTable("Certificate", [
  ["Certificate number", d.certificateNumber],
  ["Revision", d.revision],
  ["Issued", d.issuedDate],
  ["Issued by", d.issuedByName],
])}
${fieldTable("Data Book", [
  ["Book number", d.bookNumber],
  ["Title", d.bookTitle],
  ["Data Book revision", d.bookRevision],
  ["Project", d.projectName],
])}
<div class="section"><h2>Certified package</h2><table class="fv"><tbody><tr><th>SHA-256</th><td class="hash">${cell(d.packageSha256)}</td></tr></tbody></table>
<p class="note" style="margin-top:6px">Compare this fingerprint with any copy of the handover package you receive elsewhere to verify it is unmodified.</p></div>
${conditional}
${ack}
${verifyBlockHtml(d.verifyQrDataUri ?? null, d.verifyUrl ?? null, esc)}
${d.branding?.engagementMode === "white_label" ? '<div class="powered-by">Powered by JAGS Assurance</div>' : ""}
<div class="powered-by">Generated ${esc(generatedAt)}</div>
</body></html>`;
}
