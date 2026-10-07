import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { contextAs } from "../helpers/auth";
import { ROLES, roleByKey, type RoleDef } from "../helpers/env";
import { appHrefs, uuidPath, watchForMutations } from "../helpers/readonly";

/**
 * Role-based access, read-only: the pages below are guarded server-side (a redirect to /inspect, or
 * a not-found page) and must stay closed to the wrong roles. Navigation only; nothing is submitted.
 */

/** Admin-only pages. `heading` is what the page shows when it is allowed to render. */
const ADMIN_ONLY = [
  { path: "/inspect/organisation/usage", heading: /usage & cost/i },
  { path: "/inspect/organisation/staff-access", heading: /staff access/i },
  { path: "/platform", heading: /welcome back/i },
];

interface Visit {
  status: number;
  finalPath: string;
  h1: string;
}

async function visit(page: Page, path: string): Promise<Visit> {
  const response = await page.goto(path, { waitUntil: "load" });
  await page.locator("h1").first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  return {
    status: response?.status() ?? 0,
    finalPath: new URL(page.url()).pathname,
    h1: (await page.locator("h1").first().innerText().catch(() => "")).trim(),
  };
}

for (const role of ROLES) {
  test.describe(`${role.label}`, () => {
    // One signed-in context per role, shared by its tests.
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

    for (const { path, heading } of ADMIN_ONLY) {
      if (role.isAdmin) {
        test(`can open ${path}`, async () => {
          const result = await visit(page, path);
          expect(result.status).toBe(200);
          expect(result.finalPath).toBe(path);
          expect(result.h1).toMatch(heading);
        });
      } else {
        test(`is redirected away from ${path}`, async () => {
          const result = await visit(page, path);
          expect(result.finalPath, "should be bounced to the dashboard").toBe("/inspect");
          expect(result.h1).not.toMatch(heading);
        });
      }
    }

    test("/staff-access is not a page for anyone (real route is /inspect/organisation/staff-access)", async () => {
      const result = await visit(page, "/staff-access");
      // Either a 404 or a redirect is a closed door; what must never happen is a rendered page.
      expect(result.status === 404 || result.finalPath !== "/staff-access").toBe(true);
      expect(result.h1).not.toMatch(/staff access/i);
    });

    if (!role.isStaff) {
      for (const path of ["/inspect/start-work", "/inspect/settings"]) {
        test(`is redirected away from staff-only ${path}`, async () => {
          const result = await visit(page, path);
          expect(result.finalPath).toBe("/inspect");
        });
      }
    }

    if (!role.isStaff && role.key !== "client") {
      test("is redirected away from /inspect/handover (client/staff only)", async () => {
        const result = await visit(page, "/inspect/handover");
        expect(result.finalPath).toBe("/inspect");
      });
    }

    test("no write requests were made", async () => {
      expect(mutations).toEqual([]);
    });
  });
}

test.describe("cross-project isolation", () => {
  const restricted = ROLES.filter((r) => !r.isAdmin && r.key !== "inspector");

  /** Project ids (from /inspect/projects links) visible to a role, plus the open context for reuse. */
  async function projectIds(browser: import("@playwright/test").Browser, role: RoleDef) {
    const context = await contextAs(browser, role);
    const page = await context.newPage();
    await page.goto("/inspect/projects", { waitUntil: "load" });
    await page.locator("h1").first().waitFor();
    const ids = (await appHrefs(page, uuidPath("/inspect/projects"))).map((h) => h.split("?")[0].split("/").pop()!);
    return { ids, context, page };
  }

  test("a project the role is not granted is not reachable by URL", async ({ browser }) => {
    test.setTimeout(300_000);
    const adminView = await projectIds(browser, roleByKey("admin"));
    await adminView.context.close();
    const adminIds = adminView.ids;
    expect(adminIds.length, "admin should see projects").toBeGreaterThan(0);

    const problems: string[] = [];
    for (const role of restricted) {
      const own = await projectIds(browser, role);
      try {
        const foreign = adminIds.find((id) => !own.ids.includes(id));
        test.info().annotations.push({
          type: "isolation",
          description: `${role.label}: sees ${own.ids.length}/${adminIds.length} projects; probing ${foreign ?? "none (sees all)"}`,
        });
        if (!foreign) continue;
        const result = await visit(own.page, `/inspect/projects/${foreign}`);
        const denied = result.status === 404 || result.finalPath !== `/inspect/projects/${foreign}` || /not found|no access|denied/i.test(result.h1);
        if (!denied) problems.push(`${role.label} could open foreign project ${foreign} (status ${result.status}, h1 "${result.h1}")`);
      } finally {
        await own.context.close();
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
