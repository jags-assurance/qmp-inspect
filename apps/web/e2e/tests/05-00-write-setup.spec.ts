import { expect, test } from "@playwright/test";
import { contextAs } from "../helpers/auth";
import { roleByKey } from "../helpers/env";
import { E2E_PREFIX, WRITES_ENABLED, WRITES_SKIP_REASON, newRunTag, saveFixture, serviceDb, type WriteFixture } from "../helpers/writes";

/**
 * GATED WRITE SPEC (skipped unless E2E_ALLOW_WRITES=1). Step 0 of the write suite: creates the `E2E-`
 * organisation, two projects and an approved ITP with one checklist, so every later write spec has a
 * throwaway place to work and nothing touches the seeded demo projects.
 *
 * Seeding uses the service role (E2E_SUPABASE_URL / E2E_SUPABASE_SERVICE_ROLE_KEY) rather than the UI on
 * purpose: this file's job is a clean, correctly named fixture, not to re-test the create-project form.
 * Everything it inserts is named `E2E-<run tag> ...`, which is what scripts/cleanup-e2e-data.mjs matches.
 *
 * NOT RUN IN DEVELOPMENT SO FAR: written against the app's forms and the database schema, type-checked and
 * listed with `playwright test --list`, but never executed against a deployment.
 */
test.describe("write suite setup (E2E- fixtures)", () => {
  test.skip(!WRITES_ENABLED, WRITES_SKIP_REASON);

  test("seed the E2E- organisation, projects and an approved ITP with a checklist", async ({ browser }) => {
    const db = serviceDb();
    const tag = process.env.E2E_RUN_TAG?.trim() || newRunTag();
    expect(tag.startsWith(E2E_PREFIX), `the run tag must start with ${E2E_PREFIX}`).toBe(true);

    const insert = async <T extends { id: string }>(table: string, row: Record<string, unknown>): Promise<T> => {
      const { data, error } = await db.from(table).insert(row).select("*").single();
      if (error || !data) throw new Error(`seeding ${table} failed: ${error?.message}`);
      return data as T;
    };

    const org = await insert("organizations", { name: `${tag} Org`, slug: `${tag.toLowerCase()}-org` });
    const main = await insert("projects", { organization_id: org.id, project_number: `${tag}-P1`, name: `${tag} Main project`, status: "active" });
    const handover = await insert("projects", { organization_id: org.id, project_number: `${tag}-P2`, name: `${tag} Handover project`, status: "active" });
    const locationPreset = `${tag} Block A`;
    await insert("inspection_location_presets", { organization_id: org.id, project_id: main.id, name: locationPreset, sort_order: 0 });

    // An approved ITP with one activity and a one-question checklist in each project (starting an
    // inspection needs an approved ITP; the Data Book readiness gates count unapproved ITPs).
    const seedItp = async (projectId: string, label: string) => {
      const itp = await insert("itps", { project_id: projectId, itp_number: `${tag}-ITP-${label}`, title: `${tag} ITP ${label}`, status: "approved", phase: "execution" });
      const section = await insert("itp_sections", { itp_id: itp.id, section_number: 1, title: `${tag} section` });
      const item = await insert("itp_items", { section_id: section.id, item_number: "1.1", activity: `${tag} activity ${label}` });
      const template = await insert("checklist_templates", { itp_item_id: item.id, checklist_number: `${tag}-CHK-${label}`, name: `${tag} checklist ${label}` });
      await insert("checklist_items", { template_id: template.id, item_number: "1", description: `${tag} question ${label}: is the work as specified?` });
      return { itpId: itp.id, itemId: item.id, templateId: template.id };
    };
    const mainItp = await seedItp(main.id, "MAIN");
    await seedItp(handover.id, "HO");
    // The handover project is closed out, so the Data Book gates (project completed, nothing open) are met.
    const closed = await db.from("projects").update({ status: "completed" }).eq("id", handover.id);
    if (closed.error) throw new Error(`could not complete the handover project: ${closed.error.message}`);

    const fixture: WriteFixture = {
      runTag: tag,
      organizationId: org.id,
      organizationName: `${tag} Org`,
      projectId: main.id,
      projectNumber: `${tag}-P1`,
      projectName: `${tag} Main project`,
      handoverProjectId: handover.id,
      handoverProjectName: `${tag} Handover project`,
      itpId: mainItp.itpId,
      itemId: mainItp.itemId,
      checklistTemplateId: mainItp.templateId,
      locationPreset,
    };
    saveFixture(fixture);

    // The Admin (global grant) can see the new projects in the UI.
    const context = await contextAs(browser, roleByKey("admin"));
    try {
      const page = await context.newPage();
      await page.goto(`/inspect/projects/${main.id}`);
      await expect(page.locator("body")).toContainText(fixture.projectName, { timeout: 30_000 });
    } finally {
      await context.close();
    }
  });
});
