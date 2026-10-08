import { expect, test } from "@playwright/test";
import { contextAs } from "../helpers/auth";
import { roleByKey } from "../helpers/env";
import { WRITES_ENABLED, WRITES_SKIP_REASON, expectE2eContext, readFixture, serviceDb, updateFixture } from "../helpers/writes";

/**
 * GATED WRITE SPEC (skipped unless E2E_ALLOW_WRITES=1): issue the IRN (inspection release note) for the
 * passed inspection created by 05-03. Needs that spec to have run first; without its record the test is
 * skipped rather than guessing at another inspection.
 *
 * NOT RUN IN DEVELOPMENT SO FAR: selectors come from reading app/inspect/inspections/[id]/issue-irn-form.tsx;
 * the spec type-checks and lists but has never executed against a deployment.
 */
test.describe("IRN issue (writes)", () => {
  test.skip(!WRITES_ENABLED, WRITES_SKIP_REASON);

  test("issue an IRN for the passed E2E- inspection", async ({ browser }) => {
    const f = readFixture();
    test.skip(!f.inspectionRecordId, "needs the passed inspection from 05-03-inspection.spec.ts");
    const db = serviceDb();
    const recordId = f.inspectionRecordId!;
    const context = await contextAs(browser, roleByKey("admin"));
    try {
      const page = await context.newPage();
      await page.goto(`/inspect/inspections/${recordId}`);
      await expectE2eContext(page, f);

      const live = async () => (await db.from("irns").select("id, irn_number, issued_by, voided_at, project_id").eq("inspection_record_id", recordId).is("voided_at", null).maybeSingle()).data;
      expect(await live(), "no IRN exists yet").toBeNull();

      await page.getByRole("button", { name: "Issue IRN" }).click();
      await expect.poll(async () => (await live())?.irn_number, { timeout: 60_000 }).toBeTruthy();

      const irn = (await live())!;
      expect(irn.project_id, "the IRN belongs to the E2E- project").toBe(f.projectId);
      expect(irn.issued_by, "the issuer is stamped by the database").not.toBeNull();
      updateFixture({ irnNumber: irn.irn_number as string });

      await page.reload();
      await expect(page.locator("body")).toContainText(irn.irn_number as string);
    } finally {
      await context.close();
    }
  });
});
