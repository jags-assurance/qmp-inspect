import { expect, test } from "@playwright/test";
import { contextAs } from "../helpers/auth";
import { roleByKey } from "../helpers/env";
import { WRITES_ENABLED, WRITES_SKIP_REASON, e2eName, evidencePng, expectE2eContext, readFixture, serviceDb } from "../helpers/writes";

/**
 * GATED WRITE SPEC (skipped unless E2E_ALLOW_WRITES=1): raise an NCR in the E2E- project, work it
 * through start -> CAPA -> evidence -> send for verification, and close it as the Admin.
 *
 * Driven through the real forms as the JAGS Admin (global access; the only demo role that may close
 * without a custom permission). The database row is read back with the service role so a pass means
 * the NCR really is closed, not just that a button was clicked.
 *
 * NOT RUN IN DEVELOPMENT SO FAR: selectors come from reading the forms (field `name`s, button labels in
 * app/inspect/ncrs/**); the spec type-checks and lists but has never executed against a deployment.
 */
test.describe("NCR raise and close (writes)", () => {
  test.skip(!WRITES_ENABLED, WRITES_SKIP_REASON);

  test("raise an NCR, send it for verification with evidence, and close it", async ({ browser }) => {
    const f = readFixture();
    const db = serviceDb();
    const description = e2eName(f, "NCR: weld seam shows undercut beyond the acceptance limit");
    const context = await contextAs(browser, roleByKey("admin"));
    try {
      const page = await context.newPage();

      // --- raise ---
      await page.goto(`/inspect/ncrs/new?project_id=${f.projectId}`);
      await expect(page.locator("#project_id")).toHaveValue(f.projectId);
      await expectE2eContext(page, f);
      await page.locator('input[name="severity"][value="minor_ncr"]').check({ force: true });
      await page.locator('[name="description"]').fill(description);
      await page.getByRole("button", { name: "Raise NCR" }).click();
      await page.waitForURL(/\/inspect\/ncrs\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      const ncrId = new URL(page.url()).pathname.split("/").pop()!;

      const ncr = async () => (await db.from("ncrs").select("status, project_id, description, raised_by, closed_by").eq("id", ncrId).single()).data;
      expect((await ncr())?.project_id, "the NCR must be in the E2E- project").toBe(f.projectId);
      expect((await ncr())?.status).toBe("open");

      // --- start progress ---
      await expectE2eContext(page, f);
      await page.getByRole("button", { name: "Start progress" }).click();
      await expect.poll(async () => (await ncr())?.status, { timeout: 30_000 }).toBe("in_progress");
      await page.reload();

      // --- CAPA text + verification notes, then photo evidence ---
      await page.locator('[name="root_cause"]').fill(e2eName(f, "root cause: the welding parameters were outside the procedure"));
      await page.locator('[name="corrective_action"]').fill(e2eName(f, "corrective action: grind out and re-weld the seam to procedure"));
      await page.locator('[name="preventive_action"]').fill(e2eName(f, "preventive action: re-brief the welders on the parameter sheet"));
      await page.locator('[name="verification_notes"]').fill(e2eName(f, "verified: re-weld inspected and the seam is within limits"));
      await page.getByRole("button", { name: "Save progress" }).click();
      await expect.poll(async () => (await db.from("ncrs").select("root_cause").eq("id", ncrId).single()).data?.root_cause, { timeout: 30_000 }).toContain("welding parameters");

      await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles(evidencePng("e2e-ncr-evidence.png"));
      await expect
        .poll(async () => ((await db.from("ncr_photos").select("id").eq("ncr_id", ncrId)).data ?? []).length, { timeout: 60_000 })
        .toBeGreaterThan(0);

      // --- send for verification ---
      await page.reload();
      await page.getByRole("button", { name: "Send for verification" }).click();
      await expect.poll(async () => (await ncr())?.status, { timeout: 30_000 }).toBe("pending_verification");
      await page.reload();

      // --- verify and close (the Admin wrote the corrective action, so an override reason is asked for) ---
      await expectE2eContext(page, f);
      const override = page.locator('textarea[name="close_override_reason"]');
      if (await override.count()) await override.fill(e2eName(f, "admin verifying own corrective action in a throwaway E2E project"));
      await page.getByRole("button", { name: "Verify and close NCR" }).click();
      await expect.poll(async () => (await ncr())?.status, { timeout: 30_000 }).toBe("closed");
      expect((await ncr())?.closed_by, "the closer is stamped by the database").not.toBeNull();

      await page.reload();
      await expect(page.locator("body")).toContainText("Closed");
    } finally {
      await context.close();
    }
  });
});
