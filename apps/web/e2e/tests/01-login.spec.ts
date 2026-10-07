import { expect, test } from "@playwright/test";
import { ERROR_TEXT, saveState, signInViaForm } from "../helpers/auth";
import { ROLES } from "../helpers/env";

/**
 * Sign-in for every demo role, and the landing page each one gets. This is the only spec that
 * submits a form (the sign-in form); it also writes each role's session to e2e/.auth so the later
 * specs do not have to sign in again.
 */

test.describe("signed out", () => {
  test("login page renders the sign-in form", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: /^sign in/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /forgot password/i })).toBeVisible();
  });

  for (const path of ["/inspect", "/inspect/projects", "/inspect/ncrs", "/platform"]) {
    test(`${path} redirects to /login and keeps the deep link`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?next=/);
      expect(decodeURIComponent(new URL(page.url()).searchParams.get("next") ?? "")).toBe(path);
    });
  }

  test("health endpoint is reachable without a session", async ({ page }) => {
    // Fetched through the browser on purpose: the deployment's firewall (Vercel) answers 403 to
    // Playwright's node-side `request` client from some networks, while real browser navigation is
    // let through, and browser traffic is what this suite is about.
    const response = await page.goto("/api/health");
    expect(response?.status()).toBe(200);
    const body = JSON.parse(await page.locator("body").innerText());
    expect(body.status).toBe("ok");
  });
});

for (const role of ROLES) {
  test(`login as ${role.label} (${role.email}) lands on ${role.landingPath}`, async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const landed = await signInViaForm(page, role);
      expect(landed).toBe(role.landingPath);
      await expect(page).toHaveURL(new RegExp(`${role.landingPath}$`));
      // The app shell rendered (not an error boundary).
      await expect(page.locator("main, [role=main], #main-content").first()).toBeVisible();
      await expect(page.locator("body")).not.toContainText(ERROR_TEXT);
      await saveState(context, role);
    } finally {
      await context.close();
    }
  });
}
