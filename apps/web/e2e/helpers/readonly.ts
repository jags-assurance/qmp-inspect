import type { Page } from "@playwright/test";

/**
 * Read-only guard. Every state change in this app goes through a Next.js server action, which the
 * browser sends as a POST carrying a `Next-Action` header (or, for API routes, a non-GET method to
 * a same-origin /api path). The suite never intends to trigger either; this records any that happen
 * so a spec can assert the list is empty and a regression in the suite itself cannot silently
 * mutate the shared dev data.
 */
export function watchForMutations(page: Page): { violations: string[] } {
  const violations: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const sameOrigin = url.origin === new URL(page.url() || request.url()).origin;
    const isServerAction = "next-action" in request.headers();
    const isApiWrite = sameOrigin && url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method());
    if (isServerAction || isApiWrite) violations.push(`${request.method()} ${url.pathname}`);
  });
  return { violations };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const uuidPath = (prefix: string, suffix = "") => new RegExp(`^${prefix}/(${UUID})${suffix}$`, "i");

/**
 * Same-origin app paths (query string kept) of every anchor on the page whose href matches `re`.
 * Only relative hrefs are considered, so signed storage URLs and external links are never followed.
 */
export async function appHrefs(page: Page, re: RegExp): Promise<string[]> {
  const all = await page.locator("a[href^='/']").evaluateAll((anchors) =>
    anchors.map((a) => a.getAttribute("href") ?? "")
  );
  return [...new Set(all.filter((href) => re.test(href.split("?")[0])))];
}
