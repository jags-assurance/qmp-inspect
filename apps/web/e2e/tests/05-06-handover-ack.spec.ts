import { expect, test } from "@playwright/test";
import { contextAs } from "../helpers/auth";
import { roleByKey } from "../helpers/env";
import { WRITES_ENABLED, WRITES_SKIP_REASON, e2eName, readFixture, serviceDb } from "../helpers/writes";

/**
 * GATED WRITE SPEC (skipped unless E2E_ALLOW_WRITES=1): in the Handover Portal, record the client's
 * acknowledgement of the certificate issued by 05-05.
 *
 * The seeded demo client has no access to the throwaway E2E- project, so the JAGS Admin records the
 * acknowledgement ON THE CLIENT'S BEHALF (the portal asks how the client confirmed). That is the real
 * on-behalf path the app offers; the client's own button, and the client-side reject, are not covered
 * here (they need a client login granted on the E2E- project).
 *
 * NOT RUN IN DEVELOPMENT SO FAR: selectors come from reading app/inspect/handover/acknowledge-form.tsx;
 * the spec type-checks and lists but has never executed against a deployment.
 */
test.describe("handover acknowledgement (writes)", () => {
  test.skip(!WRITES_ENABLED, WRITES_SKIP_REASON);

  test("acknowledge the issued certificate on the client's behalf", async ({ browser }) => {
    const f = readFixture();
    test.skip(!f.certificateId || !f.certificateNumber, "needs the issued certificate from 05-05-databook.spec.ts");
    const db = serviceDb();
    const certificateId = f.certificateId!;
    const context = await contextAs(browser, roleByKey("admin"));
    try {
      const page = await context.newPage();
      await page.goto("/inspect/handover");
      // One card per certificate (div.overflow-hidden in app/inspect/handover/page.tsx): its heading is the certificate
      // number and its subtitle names the book, organisation and project. Certificate numbers repeat across projects
      // (HC-001 ...), so the card must ALSO carry the run tag: the suite never acts on a demo project's certificate.
      const certificate = page.locator("div.overflow-hidden.rounded-lg.border", { has: page.getByRole("heading", { name: f.certificateNumber! }), hasText: f.runTag });
      await expect(certificate, "exactly one E2E- certificate card must match").toHaveCount(1, { timeout: 30_000 });

      await certificate.getByRole("button", { name: "Acknowledge on behalf of client" }).click();
      await page.locator('[name="received_by_name"]').fill(e2eName(f, "Client Representative"));
      await page.locator('[name="received_by_company"]').fill(e2eName(f, "Client Co"));
      await page.locator('[name="on_behalf_basis"]').fill(e2eName(f, "recorded by the E2E suite from a (fictional) signed acceptance email"));
      await page.locator('input[name="confirm"]').check();
      await page.getByRole("button", { name: "Confirm acceptance" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Accept handover", exact: true }).click();

      await expect
        .poll(async () => (await db.from("handover_certificates").select("acknowledged_at").eq("id", certificateId).single()).data?.acknowledged_at, { timeout: 60_000 })
        .not.toBeNull();
      const row = (await db.from("handover_certificates").select("acknowledged_on_behalf, acknowledged_by, ack_on_behalf_basis").eq("id", certificateId).single()).data;
      expect(row?.acknowledged_on_behalf, "recorded as an on-behalf acknowledgement").toBe(true);
      expect(row?.acknowledged_by, "the acknowledging user is stamped").not.toBeNull();
      expect(row?.ack_on_behalf_basis).toContain(f.runTag);
    } finally {
      await context.close();
    }
  });
});
