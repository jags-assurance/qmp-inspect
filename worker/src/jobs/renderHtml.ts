import type { Page } from "puppeteer";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Loads HTML into a page and resolves once it is safe to capture a PDF. Replaces the old
 * `setContent(html, { waitUntil: "networkidle0" })`: Puppeteer 25 dropped `networkidle0` from the
 * waitUntil types, so the same guarantee is built from its parts, in this order:
 *   1. `load` - the document and its subresources (images) have loaded;
 *   2. no network connections for 500ms - the exact definition of networkidle0;
 *   3. `document.fonts.ready` - web fonts that were requested have been applied (so capture is
 *      never earlier than networkidle0 gave us).
 * Each wait uses the same 30s budget the old call had by default and throws on timeout.
 */
export async function setHtmlContentAndSettle(
  page: Page,
  html: string,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  await page.setContent(html, { waitUntil: "load", timeout });
  await page.waitForNetworkIdle({ idleTime: 500, timeout });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}
