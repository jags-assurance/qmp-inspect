import QRCode from "qrcode";

/**
 * QR verification of certificates / IRNs. The code encodes `<app url>/verify/<kind>/<token>`, a public
 * page that confirms number, status and hash only (verify_document() in the database). Without the app
 * URL (env PUBLIC_APP_URL or NEXT_PUBLIC_APP_URL) or without a token (migration not applied yet) no QR
 * is printed - the document renders exactly as before.
 */
export function buildVerifyUrl(kind: "certificate" | "irn", token: string | null | undefined, base = process.env.PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL): string | null {
  if (!token || !/^[0-9a-f]{32,128}$/.test(token) || !base) return null;
  return `${base.replace(/\/+$/, "")}/verify/${kind}/${token}`;
}

/** PNG data URI of a QR code for `url`, or null when it cannot be generated. */
export async function qrDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    return await QRCode.toDataURL(url, { margin: 1, width: 160, errorCorrectionLevel: "M" });
  } catch {
    return null;
  }
}

/** HTML block placed near the footer of a verifiable document. Empty string when there is no QR. */
export function verifyBlockHtml(qr: string | null, url: string | null, escape: (s: string) => string): string {
  if (!qr || !url) return "";
  return `<div class="verify" style="display:flex;align-items:center;gap:10px;margin-top:14px;page-break-inside:avoid">
    <img src="${qr}" alt="Verification QR code" style="width:72px;height:72px" />
    <div style="font-size:8.5px;color:#444;line-height:1.4">
      <strong>Verify this document</strong><br />Scan the code or open<br /><span style="font-family:'Courier New',monospace;word-break:break-all">${escape(url)}</span><br />
      to confirm its number, status and fingerprint. A printed copy is uncontrolled.
    </div>
  </div>`;
}
