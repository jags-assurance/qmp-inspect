import { expect, test, type Page } from "@playwright/test";
import { contextAs } from "../helpers/auth";
import { roleByKey } from "../helpers/env";
import { WRITES_ENABLED, WRITES_SKIP_REASON, e2eName, expectE2eContext, readFixture, serviceDb, updateFixture } from "../helpers/writes";

/**
 * GATED WRITE SPEC (skipped unless E2E_ALLOW_WRITES=1): on the E2E- handover project, create a Data Book,
 * compile it (with the Admin's override if the readiness gates are not all met), then issue it for
 * handover by uploading a package file. The issued certificate's number is saved for 05-06.
 *
 * The package upload goes from the browser straight to the generated-documents storage bucket, exactly as
 * a user's does. Issuing is irreversible: the book and certificate stay until scripts/cleanup-e2e-data.mjs
 * removes the whole E2E- project.
 *
 * NOT RUN IN DEVELOPMENT SO FAR: selectors come from reading app/inspect/projects/[projectId]/data-book/*
 * (create / compile / issue forms and the type-to-confirm dialog); the spec type-checks and lists but has
 * never executed against a deployment.
 */

/** The confirm dialog asks for the book number to be typed before its button enables. */
async function confirmTyped(page: Page, dialogName: RegExp, phrase: string, button: string) {
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  await dialog.locator("input").fill(phrase);
  await dialog.getByRole("button", { name: button, exact: true }).click();
}

test.describe("Data Book compile and issue (writes)", () => {
  test.skip(!WRITES_ENABLED, WRITES_SKIP_REASON);

  test("create a Data Book, compile it and issue it for handover", async ({ browser }) => {
    const f = readFixture();
    const db = serviceDb();
    const bookNumber = `${f.runTag}-DB1`;
    const context = await contextAs(browser, roleByKey("admin"));
    try {
      const page = await context.newPage();
      await page.goto(`/inspect/projects/${f.handoverProjectId}/data-book`);
      await expectE2eContext(page, f);

      const book = async () => (await db.from("data_books").select("id, status, project_id, book_number").eq("project_id", f.handoverProjectId).eq("book_number", bookNumber).maybeSingle()).data;

      // --- create ---
      await page.locator('[name="book_number"]').fill(bookNumber);
      await page.locator('[name="title"]').fill(e2eName(f, "Final Quality Data Book"));
      await page.getByRole("button", { name: /\+ New Data Book/ }).click();
      await expect.poll(async () => (await book())?.status, { timeout: 30_000 }).toBe("draft");
      const dataBookId = (await book())!.id as string;
      updateFixture({ dataBookId, dataBookNumber: bookNumber });

      // --- compile (override only when the page offers it, i.e. some gate is not met) ---
      await page.reload();
      await expectE2eContext(page, f);
      const override = page.getByLabel(/Compile anyway \(override/);
      if (await override.count()) {
        await override.check();
        await page.locator('textarea[name="override_reason"]').fill(e2eName(f, "compiled with an override in a throwaway E2E project"));
      }
      await page.getByRole("button", { name: "Compile Data Book" }).click();
      await confirmTyped(page, /Compile/, bookNumber, "Compile");
      await expect.poll(async () => (await book())?.status, { timeout: 60_000 }).toBe("compiled");

      // --- issue for handover: upload a package file, confirm ---
      await page.reload();
      await expectE2eContext(page, f);
      await page.locator('input[name="package_file"]').setInputFiles({
        name: `${f.runTag}-handover-package.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from(`${f.runTag} handover package placeholder\n`),
      });
      await page.getByRole("button", { name: "Issue for handover" }).click();
      await confirmTyped(page, /Issue this handover/, bookNumber, "Issue handover");

      await expect.poll(async () => (await book())?.status, { timeout: 120_000 }).toBe("issued");
      const certificate = (await db.from("handover_certificates").select("id, certificate_number, package_storage_path, acknowledged_at").eq("data_book_id", dataBookId).maybeSingle()).data;
      expect(certificate, "issuing creates the handover certificate").not.toBeNull();
      expect(certificate?.package_storage_path, "the package is stored under handover/<book id>/").toContain(`handover/${dataBookId}/`);
      expect(certificate?.acknowledged_at, "nobody has acknowledged it yet").toBeNull();
      updateFixture({ certificateId: certificate!.id as string, certificateNumber: certificate!.certificate_number as string });
    } finally {
      await context.close();
    }
  });
});
