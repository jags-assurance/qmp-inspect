import { expect, test } from "@playwright/test";
import { contextAs } from "../helpers/auth";
import { roleByKey } from "../helpers/env";
import { WRITES_ENABLED, WRITES_SKIP_REASON, drawSignature, e2eName, expectE2eContext, readFixture, serviceDb, updateFixture } from "../helpers/writes";

/**
 * GATED WRITE SPEC (skipped unless E2E_ALLOW_WRITES=1): start an inspection on the E2E- project's approved
 * ITP checklist, answer its one question, record that no photo evidence applies, sign and complete it. The
 * completed record's id is saved for the IRN spec (05-04).
 *
 * NOT RUN IN DEVELOPMENT SO FAR: selectors come from reading app/inspect/checklists/[templateId]/*
 * (start-inspection-form, response-row, evidence-missing-notice, complete-inspection-form); the spec
 * type-checks and lists but has never executed against a deployment.
 */
test.describe("inspection start and complete (writes)", () => {
  test.skip(!WRITES_ENABLED, WRITES_SKIP_REASON);

  test("start an inspection, answer, sign and complete it", async ({ browser }) => {
    const f = readFixture();
    const db = serviceDb();
    const context = await contextAs(browser, roleByKey("admin"));
    try {
      const page = await context.newPage();
      await page.goto(`/inspect/checklists/${f.checklistTemplateId}`);
      await expectE2eContext(page, f);

      // --- start (a location is required; the E2E- preset was seeded) ---
      await page.locator('select[aria-label="Project location"]').selectOption({ label: f.locationPreset });
      await page.getByRole("button", { name: "Start inspection" }).click();

      const record = async () => (await db.from("inspection_records").select("id, overall_result, project_id, signed_by_user_id").eq("project_id", f.projectId).eq("itp_item_id", f.itemId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data;
      await expect.poll(async () => (await record())?.id, { timeout: 60_000 }).toBeTruthy();
      const recordId = (await record())!.id as string;
      expect((await record())?.overall_result, "a started inspection has no result yet").toBeNull();

      // --- answer the one question ---
      await page.reload();
      await expectE2eContext(page, f);
      await page.getByRole("radiogroup", { name: /Result for item 1/ }).getByRole("radio", { name: /Yes/ }).click();
      await expect
        .poll(async () => ((await db.from("checklist_responses").select("result").eq("inspection_record_id", recordId)).data ?? [])[0]?.result, { timeout: 30_000 })
        .toBe("yes");

      // --- evidence: state that none applies (a written reason is recorded on the inspection) ---
      await page.getByRole("button", { name: /No evidence applies/ }).click();
      await page.locator("#no-evidence-reason").fill(e2eName(f, "nothing photographable: document review only, throwaway E2E inspection"));

      // --- sign and complete ---
      await drawSignature(page);
      await page.getByRole("button", { name: "Complete inspection" }).click();
      await expect.poll(async () => (await record())?.overall_result, { timeout: 60_000 }).toBe("pass");
      expect((await record())?.signed_by_user_id, "the signer is stamped by the database").not.toBeNull();

      updateFixture({ inspectionRecordId: recordId });
    } finally {
      await context.close();
    }
  });
});
