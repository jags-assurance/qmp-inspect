import { expect, test } from "@playwright/test";
import { contextAs } from "../helpers/auth";
import { roleByKey } from "../helpers/env";
import { WRITES_ENABLED, WRITES_SKIP_REASON, e2eName, evidencePng, expectE2eContext, readFixture, serviceDb } from "../helpers/writes";

/**
 * GATED WRITE SPEC (skipped unless E2E_ALLOW_WRITES=1): add a punch item to the E2E- project and mark it
 * resolved with written evidence and a photo. Closing (verification) needs a second person and is not
 * part of this spec.
 *
 * NOT RUN IN DEVELOPMENT SO FAR: selectors come from reading app/inspect/projects/[projectId]/punch-list/*;
 * the spec type-checks and lists but has never executed against a deployment.
 */
test.describe("punch item add and resolve (writes)", () => {
  test.skip(!WRITES_ENABLED, WRITES_SKIP_REASON);

  test("add a punch item, then resolve it with evidence", async ({ browser }) => {
    const f = readFixture();
    const db = serviceDb();
    const description = e2eName(f, "punch: touch up the paint on the pump house door frame");
    const context = await contextAs(browser, roleByKey("admin"));
    try {
      const page = await context.newPage();
      await page.goto(`/inspect/projects/${f.projectId}/punch-list`);
      await expectE2eContext(page, f);

      // --- add ---
      const addForm = page.locator("form", { has: page.getByRole("button", { name: /\+ Add punch item/ }) });
      await addForm.locator('[name="description"]').fill(description);
      await addForm.getByRole("button", { name: /\+ Add punch item/ }).click();

      const item = async () => (await db.from("punch_list_items").select("id, status, project_id, closing_evidence, resolved_by").eq("project_id", f.projectId).eq("description", description).maybeSingle()).data;
      await expect.poll(async () => (await item())?.status, { timeout: 30_000 }).toBe("open");

      // --- resolve ---
      await page.reload();
      await expectE2eContext(page, f);
      await page.locator("tr", { hasText: description }).getByRole("button", { name: "Resolve" }).click();
      await page.getByRole("button", { name: "Mark resolved" }).click();
      await page.locator('textarea[name="closing_evidence"]').fill(e2eName(f, "evidence: door frame repainted and signed off on site"));
      await page.locator('input[type="file"][name="closing_photos"]').setInputFiles(evidencePng("e2e-punch-fix.png"));
      await page.getByRole("button", { name: "Confirm resolved" }).click();

      await expect.poll(async () => (await item())?.status, { timeout: 60_000 }).toBe("resolved");
      expect((await item())?.resolved_by, "the resolver is stamped by the database").not.toBeNull();
    } finally {
      await context.close();
    }
  });
});
