/**
 * True for addresses that can never be a real mailbox: reserved/test top-level domains (.local, .demo,
 * .test, .invalid, .example, .localhost) and the example.* placeholder domains. Sending to them only
 * produces bounces, which hurts the sender's reputation, so the notification emailer skips them.
 * Mirrored in worker/src/notificationEmail.ts (the worker cannot import from the web app).
 */
export function isUndeliverableAddress(email: string | null | undefined): boolean {
  const at = (email ?? "").trim().toLowerCase().lastIndexOf("@");
  if (at < 0) return true;
  const domain = (email ?? "").trim().toLowerCase().slice(at + 1);
  if (!domain || !domain.includes(".")) return true;
  return /\.(local|localhost|demo|test|invalid|example)$/.test(domain) || /^example\.[a-z]+$/.test(domain);
}
