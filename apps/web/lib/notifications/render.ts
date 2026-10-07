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

/** Builds the HTML body of a notification email; every user-influenced value is escaped. */
export function renderNotificationEmailHtml(params: {
  title: string;
  body?: string | null;
  link?: string | null;
  appUrl: string;
}): string {
  const text = escapeHtml(params.body?.trim() ? params.body : params.title);
  const path = safeSitePath(params.link);
  const base = params.appUrl.replace(/\/+$/, "");
  const linkHtml = path && base ? `<p><a href="${escapeHtml(base + path)}">Open in JAGS Assurance &rarr;</a></p>` : "";
  return `<p>${text}</p>${linkHtml}`;
}
