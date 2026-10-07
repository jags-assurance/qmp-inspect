import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { contextAs, probePage } from "../helpers/auth";
import { ROLES } from "../helpers/env";
import { watchForMutations } from "../helpers/readonly";

/**
 * Every role opens each key list page and none may render an error state. Read-only: pages are
 * only navigated. Console errors are recorded as annotations (third-party noise must not fail the
 * run) but a rendered error boundary, a 4xx/5xx, or a bounce to /login does.
 */

/** Pages every signed-in role can open. */
const COMMON_PAGES = [
  { path: "/inspect", name: "Dashboard" },
  { path: "/inspect/projects", name: "Projects" },
  { path: "/inspect/itps", name: "ITP register" },
  { path: "/inspect/inspections", name: "Inspections" },
  { path: "/inspect/ncrs", name: "NCR register" },
  { path: "/inspect/observations", name: "Observations" },
  { path: "/inspect/vault", name: "Document vault" },
  { path: "/inspect/reports-documents", name: "Reports & documents" },
  { path: "/inspect/standalone", name: "Standalone assignments" },
  { path: "/inspect/notifications", name: "Notifications" },
  { path: "/inspect/guide", name: "Guide" },
];

/** Staff-only list pages. */
const STAFF_PAGES = [
  { path: "/inspect/start-work", name: "Start work" },
  { path: "/inspect/settings", name: "Settings" },
  { path: "/inspect/organisation/teams", name: "Teams" },
  { path: "/inspect/organisation/client-teams", name: "Client teams" },
];

for (const role of ROLES) {
  test.describe(`${role.label}`, () => {
    // One signed-in context per role, shared by its page tests (run in order, one worker).
    test.describe.configure({ mode: "serial" });

    const pages = [
      ...COMMON_PAGES,
      // Handover is the client's / staff's portal; contractors and TPI are redirected (see 02-access).
      ...(role.isStaff || role.key === "client" ? [{ path: "/inspect/handover", name: "Handover portal" }] : []),
      ...(role.isStaff ? STAFF_PAGES : []),
    ];

    let context: BrowserContext;
    let page: Page;
    let mutations: string[];

    test.beforeAll(async ({ browser }) => {
      context = await contextAs(browser, role);
      page = await context.newPage();
      mutations = watchForMutations(page).violations;
    });
    test.afterAll(async () => {
      await context?.close();
    });

    for (const { path, name } of pages) {
      test(`${name} loads (${path})`, async () => {
        const probe = await probePage(page, path);
        if (probe.consoleErrors.length) {
          test.info().annotations.push({
            type: "console-error",
            description: `${path}: ${probe.consoleErrors.slice(0, 2).join(" | ").slice(0, 300)}`,
          });
        }
        expect(probe.status, `HTTP status for ${path}`).toBeLessThan(400);
        expect(probe.finalPath, "must not bounce to sign-in").not.toMatch(/^\/login/);
        expect(probe.errorText, `error text rendered on ${path} (h1 "${probe.heading}")`).toBeNull();
        expect(probe.heading, `an <h1> should render on ${path}`).not.toBe("");
      });
    }

    test("no write requests were made", async () => {
      expect(mutations).toEqual([]);
    });
  });
}
