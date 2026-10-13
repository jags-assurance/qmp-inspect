// Branded "Your JAGS Assurance login" email. Deliberately never contains the temporary password —
// the admin's JAGS contact shares that separately.

import { escapeHtml, renderBrandedEmailHtml, type EmailBrandOptions } from "@/lib/notifications/render";

export const LOGIN_INVITE_SUBJECT = "Your JAGS Assurance login";

export function renderLoginInviteEmailHtml(params: {
  appUrl: string;
  loginEmail: string;
  expiresAt: string | null;
  brand?: EmailBrandOptions;
}): string {
  const base = params.appUrl.replace(/\/+$/, "");
  const expiry = params.expiresAt && Number.isFinite(Date.parse(params.expiresAt))
    ? new Date(params.expiresAt).toUTCString().replace("GMT", "UTC")
    : null;
  const p = (s: string) => `<p style="margin:0 0 16px;">${s}</p>`;
  const bodyHtml =
    p("An account has been created for you on JAGS Assurance.") +
    p(`Sign in with this email address: <strong>${escapeHtml(params.loginEmail)}</strong>`) +
    p(
      "Your temporary password is shared separately by your JAGS contact. It is not included in this email." +
        (expiry ? ` It stops working on ${escapeHtml(expiry)} if unused.` : "") +
        " You will be asked to choose a new password the first time you sign in."
    );
  return renderBrandedEmailHtml({
    title: LOGIN_INVITE_SUBJECT,
    bodyHtml,
    link: "/login",
    buttonLabel: "Sign in",
    appUrl: base,
    brand: params.brand,
    preheader: "Your JAGS Assurance account is ready.",
  });
}
