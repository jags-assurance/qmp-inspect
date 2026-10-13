// Pure helpers for notification emails (kept free of server-only imports so they unit-test cleanly).

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for safe interpolation into HTML element content or a double/single-quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * A notification link must be a same-site path: a single leading "/" and not "//" (protocol-
 * relative) or "/\" (browsers treat a backslash as a slash). Returns the link or null.
 */
export function safeSitePath(link: string | null | undefined): string | null {
  if (!link) return null;
  if (!link.startsWith("/") || link.startsWith("//") || link.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(link)) return null;
  return link;
}

export const EMAIL_BURGUNDY = "#6b1e2c";

export interface EmailBrandOptions {
  /** Organisation display name for the co-brand line. */
  orgName?: string | null;
  /** Absolute http(s) URL of the organisation logo (optional). */
  orgLogoUrl?: string | null;
}

export interface BrandedEmailParams {
  title: string;
  /** Pre-escaped HTML for the body; or use bodyText for plain text (escaped here). */
  bodyHtml?: string;
  bodyText?: string | null;
  /** Same-site path for the button (validated with safeSitePath). */
  link?: string | null;
  /** Absolute http(s) URL for the button, used instead of link when valid. */
  absoluteLink?: string | null;
  buttonLabel?: string;
  appUrl: string;
  brand?: EmailBrandOptions;
  /** Hidden inbox preview text. */
  preheader?: string;
}

function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

/** Branded, email-client-safe wrapper: tables, inline CSS, 600px max, dark-mode tolerant. */
export function renderBrandedEmailHtml(params: BrandedEmailParams): string {
  const base = params.appUrl.replace(/\/+$/, "");
  const path = safeSitePath(params.link);
  const buttonHref = safeHttpUrl(params.absoluteLink) ?? (path && base ? base + path : null);
  const bodyHtml =
    params.bodyHtml ??
    `<p style="margin:0 0 16px;">${escapeHtml(params.bodyText?.trim() ? params.bodyText : params.title).replace(/\n/g, "<br>")}</p>`;
  const logo = safeHttpUrl(base ? `${base}/icon-192.png` : null);
  const wordmark = `<span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">JAGS Assurance</span>`;
  const logoCell = logo
    ? `<td style="padding-right:12px;" width="40"><img src="${escapeHtml(logo)}" width="40" height="40" alt="" style="display:block;border:0;border-radius:6px;"></td>`
    : "";
  const orgName = params.brand?.orgName?.trim();
  const orgLogo = safeHttpUrl(params.brand?.orgLogoUrl);
  const coBrand = orgName
    ? `<tr><td style="background-color:#501623;padding:8px 24px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#f3e3e6;">${
        orgLogo ? `<img src="${escapeHtml(orgLogo)}" height="20" alt="" style="vertical-align:middle;border:0;margin-right:8px;max-width:120px;">` : ""
      }${escapeHtml(orgName)}</td></tr>`
    : "";
  const button = buttonHref
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td align="center" bgcolor="${EMAIL_BURGUNDY}" style="background-color:${EMAIL_BURGUNDY};border-radius:6px;"><a href="${escapeHtml(buttonHref)}" style="display:inline-block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${escapeHtml(params.buttonLabel ?? "Open in JAGS Assurance")}</a></td></tr></table>`
    : "";
  const links = base
    ? `<a href="${escapeHtml(base)}/inspect/support" style="color:${EMAIL_BURGUNDY};">Help and support</a> &middot; <a href="${escapeHtml(base)}/privacy" style="color:${EMAIL_BURGUNDY};">Privacy</a> &middot; <a href="${escapeHtml(base)}/terms" style="color:${EMAIL_BURGUNDY};">Terms</a><br>`
    : "";
  const pre = params.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(params.preheader)}</div>`
    : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(params.title)}</title></head><body style="margin:0;padding:0;background-color:#f4f1f1;">${pre}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f1f1" style="background-color:#f4f1f1;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;"><tr><td bgcolor="${EMAIL_BURGUNDY}" style="background-color:${EMAIL_BURGUNDY};padding:20px 24px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${logoCell}<td>${wordmark}</td></tr></table></td></tr>${coBrand}<tr><td style="padding:28px 24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222222;background-color:#ffffff;"><h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#222222;">${escapeHtml(params.title)}</h1>${bodyHtml}${button}</td></tr><tr><td style="padding:16px 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6b6b6b;border-top:1px solid #e6e0e0;background-color:#ffffff;">${links}This is an automated message from JAGS Assurance. Please do not reply to this email.</td></tr></table></td></tr></table></body></html>`;
}

/** Builds the HTML body of a notification email; every user-influenced value is escaped. */
export function renderNotificationEmailHtml(params: {
  title: string;
  body?: string | null;
  link?: string | null;
  appUrl: string;
  brand?: EmailBrandOptions;
}): string {
  return renderBrandedEmailHtml({ title: params.title, bodyText: params.body, link: params.link, appUrl: params.appUrl, brand: params.brand });
}
